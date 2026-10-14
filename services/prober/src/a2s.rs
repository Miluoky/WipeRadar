//! Valve Server Query (A2S) over a single shared UDP socket.
//!
//! One socket serves every target: a background task receives all datagrams and
//! routes them to the waiting request by source address. That keeps the file
//! descriptor count flat no matter how many servers we probe, which is what lets
//! one small box sweep tens of thousands of Rust servers.
//!
//! Handles S2C_CHALLENGE (0x41) and Source-style split replies (0xFFFFFFFE).

use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;
use tokio::sync::mpsc;

const SIMPLE: i32 = -1;
const SPLIT: i32 = -2;

const S2C_CHALLENGE: u8 = 0x41;
const A2S_INFO: u8 = 0x54;
const A2S_INFO_REPLY: u8 = 0x49;
const A2S_RULES: u8 = 0x56;
const A2S_RULES_REPLY: u8 = 0x45;

const INFO_PAYLOAD: &[u8] = b"Source Engine Query\0";

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub protocol: u8,
    pub name: String,
    pub map: String,
    pub folder: String,
    pub game: String,
    pub app_id: u16,
    pub players: u8,
    pub max_players: u8,
    pub bots: u8,
    pub version: String,
    pub game_port: Option<u16>,
    pub steam_id: Option<String>,
    pub keywords: Option<String>,
}

pub type Rules = BTreeMap<String, String>;

#[derive(Debug, Clone, PartialEq)]
pub enum ProbeError {
    Timeout,
    Busy,
    Protocol(String),
    Io(String),
}

impl fmt::Display for ProbeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProbeError::Timeout => write!(f, "timeout"),
            ProbeError::Busy => write!(f, "another query to this address is in flight"),
            ProbeError::Protocol(m) => write!(f, "protocol: {m}"),
            ProbeError::Io(m) => write!(f, "io: {m}"),
        }
    }
}

impl From<std::io::Error> for ProbeError {
    fn from(e: std::io::Error) -> Self {
        ProbeError::Io(e.to_string())
    }
}

/// Little-endian cursor; every read is bounds-checked.
struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(buf: &'a [u8], pos: usize) -> Self {
        Self { buf, pos }
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8], ProbeError> {
        let end = self.pos.checked_add(n).filter(|&e| e <= self.buf.len());
        let end = end.ok_or_else(|| ProbeError::Protocol("truncated packet".into()))?;
        let s = &self.buf[self.pos..end];
        self.pos = end;
        Ok(s)
    }
    fn remaining(&self) -> usize {
        self.buf.len().saturating_sub(self.pos)
    }
    fn u8(&mut self) -> Result<u8, ProbeError> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, ProbeError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, ProbeError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn cstr(&mut self) -> Result<String, ProbeError> {
        let rest = &self.buf[self.pos.min(self.buf.len())..];
        let len = rest
            .iter()
            .position(|&b| b == 0)
            .ok_or_else(|| ProbeError::Protocol("unterminated string".into()))?;
        let s = String::from_utf8_lossy(&rest[..len]).into_owned();
        self.pos += len + 1;
        Ok(s)
    }
}

/// `body` starts at the reply type byte (0x49).
pub fn parse_info(body: &[u8]) -> Result<Info, ProbeError> {
    let mut r = Reader::new(body, 1);
    let mut info = Info {
        protocol: r.u8()?,
        name: r.cstr()?,
        map: r.cstr()?,
        folder: r.cstr()?,
        game: r.cstr()?,
        app_id: r.u16()?,
        players: r.u8()?,
        max_players: r.u8()?,
        bots: r.u8()?,
        ..Default::default()
    };
    r.take(4)?; // server type, environment, visibility, vac
    info.version = r.cstr()?;
    if r.remaining() > 0 {
        let edf = r.u8()?;
        if edf & 0x80 != 0 {
            info.game_port = Some(r.u16()?);
        }
        if edf & 0x10 != 0 {
            info.steam_id = Some(r.u64()?.to_string());
        }
        if edf & 0x40 != 0 {
            r.u16()?;
            r.cstr()?;
        }
        if edf & 0x20 != 0 {
            info.keywords = Some(r.cstr()?);
        }
    }
    Ok(info)
}

/// `body` starts at the reply type byte (0x45).
pub fn parse_rules(body: &[u8]) -> Result<Rules, ProbeError> {
    let mut r = Reader::new(body, 1);
    let count = r.u16()?;
    let mut rules = Rules::new();
    for _ in 0..count {
        if r.remaining() == 0 {
            break; // some servers lie about the count
        }
        let k = r.cstr()?;
        let v = r.cstr()?;
        rules.insert(k, v);
    }
    Ok(rules)
}

fn header(kind: u8) -> Vec<u8> {
    let mut h = SIMPLE.to_le_bytes().to_vec();
    h.push(kind);
    h
}

fn info_request(challenge: Option<[u8; 4]>) -> Vec<u8> {
    let mut p = header(A2S_INFO);
    p.extend_from_slice(INFO_PAYLOAD);
    if let Some(c) = challenge {
        p.extend_from_slice(&c);
    }
    p
}

fn rules_request(challenge: Option<[u8; 4]>) -> Vec<u8> {
    let mut p = header(A2S_RULES);
    p.extend_from_slice(&challenge.unwrap_or([0xff; 4]));
    p
}

type Pending = Arc<Mutex<HashMap<SocketAddr, mpsc::UnboundedSender<Vec<u8>>>>>;

/// Removes the routing entry however the request ends (reply, error, timeout, cancel).
struct PendingGuard {
    pending: Pending,
    addr: SocketAddr,
}

impl Drop for PendingGuard {
    fn drop(&mut self) {
        self.pending.lock().unwrap().remove(&self.addr);
    }
}

pub struct Prober {
    sock: Arc<UdpSocket>,
    pending: Pending,
}

impl Prober {
    pub async fn bind(local: &str) -> std::io::Result<Arc<Self>> {
        let sock = Arc::new(UdpSocket::bind(local).await?);
        let pending: Pending = Arc::default();
        let (rx_sock, rx_pending) = (sock.clone(), pending.clone());
        tokio::spawn(async move {
            let mut buf = vec![0u8; 65_536];
            loop {
                match rx_sock.recv_from(&mut buf).await {
                    Ok((n, from)) => {
                        let tx = rx_pending.lock().unwrap().get(&from).cloned();
                        if let Some(tx) = tx {
                            let _ = tx.send(buf[..n].to_vec());
                        }
                    }
                    // Windows reports ICMP port-unreachable from an earlier send as
                    // WSAECONNRESET on the next recv. It's per-target noise, not fatal.
                    Err(_) => continue,
                }
            }
        });
        Ok(Arc::new(Self { sock, pending }))
    }

    async fn exchange(
        &self,
        target: SocketAddr,
        build: fn(Option<[u8; 4]>) -> Vec<u8>,
        expect: u8,
        wait: Duration,
    ) -> Result<(Vec<u8>, u32), ProbeError> {
        let (tx, mut rx) = mpsc::unbounded_channel();
        {
            let mut p = self.pending.lock().unwrap();
            if p.contains_key(&target) {
                return Err(ProbeError::Busy);
            }
            p.insert(target, tx);
        }
        let _guard = PendingGuard { pending: self.pending.clone(), addr: target };

        let mut started = Instant::now();
        self.sock.send_to(&build(None), target).await?;
        let deadline = tokio::time::Instant::now() + wait;
        let mut challenged = false;
        let mut split: Option<(u8, HashMap<u8, Vec<u8>>)> = None;

        loop {
            let pkt = match tokio::time::timeout_at(deadline, rx.recv()).await {
                Ok(Some(p)) => p,
                Ok(None) => return Err(ProbeError::Io("channel closed".into())),
                Err(_) => return Err(ProbeError::Timeout),
            };
            if pkt.len() < 5 {
                continue;
            }
            let kind = i32::from_le_bytes(pkt[0..4].try_into().unwrap());
            let body = if kind == SIMPLE {
                pkt[4..].to_vec()
            } else if kind == SPLIT && pkt.len() >= 12 {
                let id = i32::from_le_bytes(pkt[4..8].try_into().unwrap());
                if id < 0 {
                    return Err(ProbeError::Protocol("compressed split packets unsupported".into()));
                }
                let (total, number) = (pkt[8], pkt[9]);
                let (want, parts) = split.get_or_insert_with(|| (total, HashMap::new()));
                parts.insert(number, pkt[12..].to_vec());
                if parts.len() < *want as usize {
                    continue;
                }
                let mut whole = Vec::new();
                for i in 0..*want {
                    let part = parts.get(&i).ok_or_else(|| ProbeError::Protocol("missing split part".into()))?;
                    whole.extend_from_slice(part);
                }
                split = None;
                if whole.len() < 5 || i32::from_le_bytes(whole[0..4].try_into().unwrap()) != SIMPLE {
                    return Err(ProbeError::Protocol("bad split payload".into()));
                }
                whole[4..].to_vec()
            } else {
                continue;
            };

            match body[0] {
                S2C_CHALLENGE if !challenged && body.len() >= 5 => {
                    challenged = true;
                    started = Instant::now(); // ping = the real query round-trip
                    self.sock.send_to(&build(Some([body[1], body[2], body[3], body[4]])), target).await?;
                }
                t if t == expect => return Ok((body, started.elapsed().as_millis() as u32)),
                t => return Err(ProbeError::Protocol(format!("unexpected reply 0x{t:02x}"))),
            }
        }
    }

    pub async fn info(&self, target: SocketAddr, wait: Duration) -> Result<(Info, u32), ProbeError> {
        let (body, ping) = self.exchange(target, info_request, A2S_INFO_REPLY, wait).await?;
        Ok((parse_info(&body)?, ping))
    }

    pub async fn rules(&self, target: SocketAddr, wait: Duration) -> Result<Rules, ProbeError> {
        let (body, _) = self.exchange(target, rules_request, A2S_RULES_REPLY, wait).await?;
        parse_rules(&body)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn cstr(s: &str) -> Vec<u8> {
        let mut v = s.as_bytes().to_vec();
        v.push(0);
        v
    }

    /// Rust-like fake server: demands a challenge, splits RULES over 2+ packets (out of order).
    pub async fn fake_server(keywords: &'static str) -> SocketAddr {
        let sock = Arc::new(UdpSocket::bind("127.0.0.1:0").await.unwrap());
        let addr = sock.local_addr().unwrap();
        tokio::spawn(async move {
            let challenge = [0x11u8, 0x22, 0x33, 0x44];
            let mut buf = [0u8; 2048];
            loop {
                let Ok((n, from)) = sock.recv_from(&mut buf).await else { continue };
                let req = &buf[..n];
                let kind = req[4];
                let given = if kind == A2S_INFO { req.get(25..29) } else { req.get(5..9) };
                if given != Some(&challenge[..]) {
                    let mut r = header(S2C_CHALLENGE);
                    r.extend_from_slice(&challenge);
                    sock.send_to(&r, from).await.unwrap();
                    continue;
                }
                if kind == A2S_INFO {
                    let mut r = header(A2S_INFO_REPLY);
                    r.push(17);
                    for s in ["[EU] Fake x2 Duo", "Procedural Map", "rust", "Rust"] {
                        r.extend(cstr(s));
                    }
                    r.extend_from_slice(&0u16.to_le_bytes());
                    r.extend_from_slice(&[200, 250, 0, b'd', b'l', 0, 1]);
                    r.extend(cstr("2593"));
                    r.push(0x80 | 0x20);
                    r.extend_from_slice(&28015u16.to_le_bytes());
                    r.extend(cstr(keywords));
                    sock.send_to(&r, from).await.unwrap();
                } else if kind == A2S_RULES {
                    let mut body = header(A2S_RULES_REPLY);
                    let rules: Vec<(String, String)> = vec![
                        ("world.seed".into(), "1337420".into()),
                        ("world.size".into(), "4250".into()),
                        ("description_0".into(), "x".repeat(900)),
                    ];
                    body.extend_from_slice(&(rules.len() as u16).to_le_bytes());
                    for (k, v) in &rules {
                        body.extend(cstr(k));
                        body.extend(cstr(v));
                    }
                    let chunks: Vec<&[u8]> = body.chunks(400).collect();
                    for (i, c) in chunks.iter().enumerate().rev() {
                        let mut p = SPLIT.to_le_bytes().to_vec();
                        p.extend_from_slice(&7i32.to_le_bytes());
                        p.push(chunks.len() as u8);
                        p.push(i as u8);
                        p.extend_from_slice(&400u16.to_le_bytes());
                        p.extend_from_slice(c);
                        sock.send_to(&p, from).await.unwrap();
                    }
                }
            }
        });
        addr
    }

    #[tokio::test]
    async fn info_with_challenge() {
        let srv = fake_server("mp400,cp312,qp17,born1728547200").await;
        let p = Prober::bind("127.0.0.1:0").await.unwrap();
        let (info, _) = p.info(srv, Duration::from_secs(2)).await.unwrap();
        assert_eq!(info.name, "[EU] Fake x2 Duo");
        assert_eq!(info.players, 200);
        assert_eq!(info.game_port, Some(28015));
        assert_eq!(info.keywords.as_deref(), Some("mp400,cp312,qp17,born1728547200"));
    }

    #[tokio::test]
    async fn rules_split_and_challenge() {
        let srv = fake_server("").await;
        let p = Prober::bind("127.0.0.1:0").await.unwrap();
        let rules = p.rules(srv, Duration::from_secs(2)).await.unwrap();
        assert_eq!(rules["world.seed"], "1337420");
        assert_eq!(rules["world.size"], "4250");
        assert_eq!(rules["description_0"].len(), 900);
    }

    #[tokio::test]
    async fn timeout_on_silent_target() {
        let silent = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let p = Prober::bind("127.0.0.1:0").await.unwrap();
        let err = p.info(silent.local_addr().unwrap(), Duration::from_millis(200)).await.unwrap_err();
        assert_eq!(err, ProbeError::Timeout);
    }

    #[test]
    fn truncated_info_is_an_error_not_a_panic() {
        assert!(parse_info(&[0x49, 17, b'a']).is_err());
        assert!(parse_rules(&[0x45]).is_err());
    }
}
