import { config } from "../config";
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
  {
    // images are https-only now (mixed content); drop the http ones already stored
    id: "005_https_images",
    sql: /* sql */ `
      UPDATE servers SET header_image = NULL WHERE header_image LIKE 'http:%';
      UPDATE servers SET logo_image = NULL WHERE logo_image LIKE 'http:%';
      UPDATE servers SET map_image = NULL WHERE map_image LIKE 'http:%';
    `,
  },
];

/** Applied only on real Postgres with the timescaledb extension available. */
const TIMESCALE = /* sql */ `
  CREATE EXTENSION IF NOT EXISTS timescaledb;
  SELECT create_hypertable('metrics', 'ts', chunk_time_interval => INTERVAL '1 day', migrate_data => true, if_not_exists => true);
  ALTER TABLE metrics SET (timescaledb.compress, timescaledb.compress_segmentby = 'server_id');
  SELECT add_compression_policy('metrics', INTERVAL '2 days', if_not_exists => true);
`;

/** Postgres only, when pg_trgm is available: lets `search_key LIKE '%…%'` use an index instead of a full scan. */
const TRGM = /* sql */ `
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS servers_search_trgm ON servers USING gin (search_key gin_trgm_ops);
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
      done.add("timescale");
    }
  }
  if (db.kind === "postgres" && !done.has("trgm")) {
    try {
      const { rows: ext } = await db.query(`SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm'`);
      if (ext.length) {
        await db.exec(TRGM);
        await db.query(`INSERT INTO schema_migrations (id) VALUES ('trgm')`);
        console.log("[db] pg_trgm search index created");
      }
    } catch (e) {
      // e.g. no privilege to create extensions — search still works, just unindexed
      console.warn("[db] pg_trgm search index skipped:", (e as Error).message);
    }
  }
  if (done.has("timescale")) {
    // re-applied on every start so METRICS_RETENTION_DAYS changes take effect
    try {
      await db.query(`SELECT remove_retention_policy('metrics', if_exists => true)`);
      await db.query(`SELECT add_retention_policy('metrics', make_interval(days => $1))`, [config.metricsRetentionDays]);
    } catch (e) {
      console.warn("[db] could not update metrics retention policy:", (e as Error).message);
    }
  }
}
