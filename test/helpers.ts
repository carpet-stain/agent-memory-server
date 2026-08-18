import { Pool } from "pg";
import { ensureSchema } from "../src/db/pool.js";

export function requireTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      "DATABASE_URL_TEST is not set — point it at a disposable local/dockerized Postgres (see .envrc.local.example), never a real Neon database",
    );
  }
  return url;
}

export async function freshPool(): Promise<Pool> {
  const pool = new Pool({ connectionString: requireTestDatabaseUrl() });
  await ensureSchema(pool);
  await pool.query("TRUNCATE relations, entities");
  return pool;
}
