import { mkdirSync } from "node:fs";
import { config } from "../config";
import { migrate } from "./migrations";

export interface Db {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  kind: "postgres" | "pglite";
}

/** Postgres in production (DATABASE_URL), embedded PGlite for local dev — same SQL dialect. */
export async function openDb(): Promise<Db> {
  let db: Db;
  if (config.databaseUrl) {
    const { default: pg } = await import("pg");
    // BIGINT/NUMERIC as JS numbers (seeds fit into 2^53)
    pg.types.setTypeParser(20, (v) => Number(v));
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    db = {
      kind: "postgres",
      query: (sql, params) => pool.query(sql, params as unknown[]) as never,
      exec: async (sql) => void (await pool.query(sql)),
      close: () => pool.end(),
    };
  } else {
    const { PGlite, types } = await import("@electric-sql/pglite");
    // "memory://" = throwaway in-memory database (e2e tests)
    if (!config.pgliteDir.startsWith("memory://")) mkdirSync(config.pgliteDir, { recursive: true });
    const lite = await PGlite.create(config.pgliteDir, {
      parsers: { [types.INT8]: (v: string) => Number(v) },
    });
    db = {
      kind: "pglite",
      query: (sql, params) => lite.query(sql, params) as never,
      exec: async (sql) => void (await lite.exec(sql)),
      close: () => lite.close(),
    };
  }
  await migrate(db);
  return db;
}
