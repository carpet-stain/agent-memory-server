import { createPool, ensureSchema } from "../db/pool.js";
import { readGraphFromJsonl } from "./jsonl.js";

// Re-runnable: each run makes Postgres mirror the JSONL file's current state
// exactly (existing rows are cleared first), matching the "import → freeze →
// cutover" window where JSONL stays authoritative and Postgres can be
// re-imported as many times as needed before the freeze-point parity diff.
export async function importJsonlToPostgres(
  jsonlPath: string,
  databaseUrl: string,
): Promise<{ entities: number; relations: number }> {
  const graph = await readGraphFromJsonl(jsonlPath);
  const pool = createPool(databaseUrl);
  try {
    await ensureSchema(pool);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(1)");
      await client.query("TRUNCATE relations, entities");
      for (const e of graph.entities) {
        await client.query(
          "INSERT INTO entities (name, entity_type, observations) VALUES ($1, $2, $3)",
          [e.name, e.entityType, e.observations],
        );
      }
      for (const r of graph.relations) {
        await client.query(
          "INSERT INTO relations (from_entity, to_entity, relation_type) VALUES ($1, $2, $3)",
          [r.from, r.to, r.relationType],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return {
      entities: graph.entities.length,
      relations: graph.relations.length,
    };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const jsonlPath = process.argv[2];
  const databaseUrl = process.env.DATABASE_URL;
  if (!jsonlPath || !databaseUrl) {
    console.error(
      "usage: DATABASE_URL=... tsx src/migrate/import.ts <path-to-jsonl>",
    );
    process.exit(1);
  }
  const counts = await importJsonlToPostgres(jsonlPath, databaseUrl);
  console.log(
    `imported ${counts.entities} entities, ${counts.relations} relations from ${jsonlPath}`,
  );
}

// Only run as a CLI, not when imported by tests.
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
