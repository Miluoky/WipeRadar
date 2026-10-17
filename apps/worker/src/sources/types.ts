/** One row of a server-list snapshot (shape of Steam GetServerList). */
export interface ListEntry {
  ip: string;
  queryPort: number;
  gamePort: number;
  name: string;
  map: string;
  players: number;
  maxPlayers: number;
  /** Rust keywords string: mp/cp/qp/born/... */
  keywords: string;
  /** Steam region code (0 US-E, 1 US-W, 2 SA, 3 EU, 4 Asia, 5 AU, 6 ME, 7 AF, 255 world) */
  steamRegion?: number;
}

export interface ServerSource {
  readonly name: string;
  fetchList(): Promise<ListEntry[]>;
  /** Set by fetchList when one of several list requests came back suspiciously short. */
  readonly lastListPartial?: boolean;
  fetchRules(ip: string, queryPort: number): Promise<Record<string, string>>;
  /** Optional bulk path (Rust prober). Result order matches `targets`; a failed target is an Error. */
  fetchRulesBatch?(targets: { ip: string; queryPort: number }[]): Promise<(Record<string, string> | Error)[]>;
}
