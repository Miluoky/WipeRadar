//! WipeRadar prober — HTTP front for the shared-socket A2S engine.
//!
//!   POST /probe  {"targets":["1.2.3.4:28017",...],"info":true,"rules":true,"timeoutMs":2500}
//!   GET  /health
//!
//! CLI: `wiperadar-prober query 1.2.3.4:28017` prints INFO + RULES as JSON.
//!
//! Env: PROBER_ADDR (127.0.0.1:4100), PROBER_CONCURRENCY (512), PROBER_PER_HOST (3)

mod a2s;

use a2s::{Info, ProbeError, Prober, Rules};
use axum::{extract::State, routing::get, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

const MAX_TARGETS: usize = 5000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeRequest {
    targets: Vec<String>,
    #[serde(default = "yes")]
    info: bool,
    #[serde(default)]
    rules: bool,
    timeout_ms: Option<u64>,
}

fn yes() -> bool {
    true
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProbeResult {
    addr: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    ping_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    info: Option<Info>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rules: Option<Rules>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

struct App {
    prober: Arc<Prober>,
    global: Arc<Semaphore>,
    per_host: usize,
    hosts: Mutex<HashMap<IpAddr, Arc<Semaphore>>>,
}

impl App {
    /// Anti-DDoS on hosting providers bans bursts per IP, so one box gets at most `per_host` queries at once.
    fn host_gate(&self, ip: IpAddr) -> Arc<Semaphore> {
        let mut m = self.hosts.lock().unwrap();
        if m.len() > 100_000 {
            m.retain(|_, s| Arc::strong_count(s) > 1); // drop idle gates
        }
        m.entry(ip).or_insert_with(|| Arc::new(Semaphore::new(self.per_host))).clone()
    }
}

/// One retry on timeout (UDP loss), none on protocol errors.
async fn with_retry<T, F, Fut>(f: F) -> Result<T, ProbeError>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, ProbeError>>,
{
    match f().await {
        Err(ProbeError::Timeout) => f().await,
        other => other,
    }
}

async fn probe_one(app: Arc<App>, addr: String, want_info: bool, want_rules: bool, wait: Duration) -> ProbeResult {
    let mut res = ProbeResult { addr: addr.clone(), ok: false, ping_ms: None, info: None, rules: None, error: None };
    let target: SocketAddr = match addr.parse() {
        Ok(a) => a,
        Err(_) => {
            res.error = Some("invalid address".into());
            return res;
        }
    };
    let _g = app.global.clone().acquire_owned().await.unwrap();
    let _h = app.host_gate(target.ip()).acquire_owned().await.unwrap();

    if want_info {
        match with_retry(|| app.prober.info(target, wait)).await {
            Ok((info, ping)) => {
                res.info = Some(info);
                res.ping_ms = Some(ping);
            }
            Err(e) => {
                res.error = Some(e.to_string());
                return res;
            }
        }
    }
    if want_rules {
        match with_retry(|| app.prober.rules(target, wait)).await {
            Ok(r) => res.rules = Some(r),
            // RULES is often blocked while INFO works — partial success still counts
            Err(e) => res.error = Some(e.to_string()),
        }
    }
    res.ok = res.info.is_some() || res.rules.is_some();
    res
}

async fn probe(State(app): State<Arc<App>>, Json(req): Json<ProbeRequest>) -> Json<Vec<ProbeResult>> {
    let wait = Duration::from_millis(req.timeout_ms.unwrap_or(2500).clamp(200, 10_000));
    let mut set = JoinSet::new();
    for (i, addr) in req.targets.into_iter().take(MAX_TARGETS).enumerate() {
        let app = app.clone();
        set.spawn(async move { (i, probe_one(app, addr, req.info, req.rules, wait).await) });
    }
    let mut out: Vec<(usize, ProbeResult)> = Vec::with_capacity(set.len());
    while let Some(Ok(r)) = set.join_next().await {
        out.push(r);
    }
    out.sort_by_key(|(i, _)| *i);
    Json(out.into_iter().map(|(_, r)| r).collect())
}

fn env_usize(key: &str, default: usize) -> usize {
    std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let prober = Prober::bind("0.0.0.0:0").await?;

    if args.get(1).map(String::as_str) == Some("query") {
        let target: SocketAddr = args.get(2).and_then(|a| a.parse().ok()).expect("usage: query <ip:queryPort>");
        let wait = Duration::from_millis(2500);
        let info = prober.info(target, wait).await;
        let rules = prober.rules(target, wait).await;
        let json = serde_json::json!({
            "info": info.as_ref().map(|(i, _)| i).ok(),
            "pingMs": info.as_ref().map(|(_, p)| p).ok(),
            "rules": rules.as_ref().ok(),
            "errors": [info.err().map(|e| e.to_string()), rules.err().map(|e| e.to_string())],
        });
        println!("{}", serde_json::to_string_pretty(&json).unwrap());
        return Ok(());
    }

    let app = Arc::new(App {
        prober,
        global: Arc::new(Semaphore::new(env_usize("PROBER_CONCURRENCY", 512))),
        per_host: env_usize("PROBER_PER_HOST", 3),
        hosts: Mutex::default(),
    });
    let router = Router::new()
        .route("/health", get(|| async { Json(serde_json::json!({ "ok": true })) }))
        .route("/probe", post(probe))
        .with_state(app);

    let bind = std::env::var("PROBER_ADDR").unwrap_or_else(|_| "127.0.0.1:4100".into());
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    println!("[prober] listening on http://{bind}");
    axum::serve(listener, router).await
}
