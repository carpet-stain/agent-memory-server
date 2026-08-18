import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const SCHEMA_PATH = fileURLToPath(new URL("schema.sql", import.meta.url));

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}

// Idempotent — safe to call on every boot. A dedicated migration tool is
// overkill for one additive table pair; this is the entire schema.
export async function ensureSchema(pool: Pool): Promise<void> {
  const ddl = readFileSync(SCHEMA_PATH, "utf-8");
  await pool.query(ddl);
}
