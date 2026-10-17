import { PGlite, types } from "@electric-sql/pglite";
import type { Db } from "./db";
import { migrate } from "./db/migrations";

/** Fresh in-memory PGlite with all migrations applied — for integration tests. */
export async function memoryDb(): Promise<Db> {
  const lite = await PGlite.create({ parsers: { [types.INT8]: (v: string) => Number(v) } });
  const db: Db = {
    kind: "pglite",
    query: (sql, params) => lite.query(sql, params) as never,
    exec: async (sql) => void (await lite.exec(sql)),
    close: () => lite.close(),
  };
  await migrate(db);
  return db;
}
