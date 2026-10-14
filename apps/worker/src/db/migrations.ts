import type { Db } from "./index";

/** Append-only. Never edit a migration that has shipped. */
const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "001_core",
    sql: /* sql */ `
      CREATE TABLE servers (
        id               SERIAL PRIMARY KEY,
        ip               TEXT NOT NULL,
        query_port       INT  NOT NULL,
        game_port        INT  NOT NULL,
        name             TEXT NOT NULL,
        description      TEXT,
        url              TEXT,
        header_image     TEXT,
        map              TEXT,
        seed             BIGINT,
        world_size       INT,
        players          INT  NOT NULL DEFAULT 0,
        max_players      INT  NOT NULL DEFAULT 0,
        queue            INT  NOT NULL DEFAULT 0,
        region           TEXT,
        country          TEXT,
        rate             TEXT,
        group_limit      TEXT,
        type             TEXT NOT NULL DEFAULT 'community',
        cadence          TEXT,
        tags             TEXT[] NOT NULL DEFAULT '{}',
        build            TEXT,
        fps              INT,
        entities         INT,
        born_at          TIMESTAMPTZ,
        last_wipe_at     TIMESTAMPTZ,
        next_wipe_at     TIMESTAMPTZ,
        next_wipe_source TEXT,
        hostname_wipe_date DATE,
        online           BOOLEAN NOT NULL DEFAULT TRUE,
        misses           INT NOT NULL DEFAULT 0,
        promoted         BOOLEAN NOT NULL DEFAULT FALSE,
        suspicious       BOOLEAN NOT NULL DEFAULT FALSE,
        rules_checked_at TIMESTAMPTZ,
        first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (ip, query_port)
      );
      CREATE INDEX servers_wiped_idx   ON servers (last_wipe_at DESC) WHERE online;
      CREATE INDEX servers_next_idx    ON servers (next_wipe_at)      WHERE online;
      CREATE INDEX servers_players_idx ON servers (players DESC)      WHERE online;
      CREATE INDEX servers_filter_idx  ON servers (region, rate, group_limit, type);

      CREATE TABLE wipes (
        id          BIGSERIAL PRIMARY KEY,
        server_id   INT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        wiped_at    TIMESTAMPTZ NOT NULL,
        kind        TEXT NOT NULL,          -- map | full | force
        seed        BIGINT,
        world_size  INT,
        map         TEXT,
        detected_by TEXT NOT NULL,          -- born | born-initial | owner | demo
        UNIQUE (server_id, wiped_at)
      );
      CREATE INDEX wipes_time_idx ON wipes (wiped_at DESC);

      -- owner-provided or parsed schedules (VK/TG/Discord, hostname)
      CREATE TABLE wipe_schedules (
        server_id   INT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
        weekdays    INT[] NOT NULL DEFAULT '{}', -- 0=Sun..6=Sat
        hour_utc    INT,
        period_days INT,
        next_at     TIMESTAMPTZ,
        source      TEXT NOT NULL,               -- owner | vk | telegram | discord | hostname
        source_url  TEXT,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- server claim: owner puts the token into the server description, we see it via A2S_RULES
      CREATE TABLE server_claims (
        id          BIGSERIAL PRIMARY KEY,
        server_id   INT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        contact     TEXT NOT NULL,
        token       TEXT NOT NULL UNIQUE,
        verified_at TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE metrics (
        server_id INT NOT NULL,
        ts        TIMESTAMPTZ NOT NULL,
        players   SMALLINT NOT NULL,
        queue     SMALLINT NOT NULL DEFAULT 0,
        PRIMARY KEY (server_id, ts)
      );
    `,
  },
  {
    id: "002_search_logo",
    sql: /* sql */ `
      ALTER TABLE servers ADD COLUMN search_key TEXT;
      ALTER TABLE servers ADD COLUMN logo_image TEXT;
      ALTER TABLE servers ADD COLUMN peak_players INT NOT NULL DEFAULT 0;
    `,
  },
  {
    // one-off: re-read RULES for everyone so logos (new column) appear without waiting for the 6h TTL
    id: "003_backfill_logos",
    sql: /* sql */ `UPDATE servers SET rules_checked_at = NULL WHERE logo_image IS NULL;`,
  },
  {
    // Facepunch-rendered map image (A2S rule "map_image_url") — the real map, not a schematic
    id: "004_map_image",
    sql: /* sql */ `
      ALTER TABLE servers ADD COLUMN map_image TEXT;
      UPDATE servers SET rules_checked_at = NULL;
    `,
  },
];

/** Applied only on real Postgres with the timescaledb extension available. */
const TIMESCALE = /* sql */ `
  CREATE EXTENSION IF NOT EXISTS timescaledb;
  SELECT create_hypertable('metrics', 'ts', chunk_time_interval => INTERVAL '1 day', migrate_data => true, if_not_exists => true);
  ALTER TABLE metrics SET (timescaledb.compress, timescaledb.compress_segmentby = 'server_id');
  SELECT add_compression_policy('metrics', INTERVAL '2 days', if_not_exists => true);
  SELECT add_retention_policy('metrics', INTERVAL '35 days', if_not_exists => true);
`;

export async function migrate(db: Db) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM schema_migrations`);
  const done = new Set(rows.map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.exec(`BEGIN; ${m.sql}; INSERT INTO schema_migrations (id) VALUES ('${m.id}'); COMMIT;`);
    console.log(`[db] applied ${m.id}`);
  }
  if (db.kind === "postgres" && !done.has("timescale")) {
    const { rows: ext } = await db.query(`SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'`);
    if (ext.length) {
      await db.exec(TIMESCALE);
      await db.query(`INSERT INTO schema_migrations (id) VALUES ('timescale')`);
      console.log("[db] timescaledb enabled for metrics");
    }
  }
}
