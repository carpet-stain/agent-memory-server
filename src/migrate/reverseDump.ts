import { createPool } from "../db/pool.js";
import { KnowledgeGraphStore } from "../db/store.js";
import { writeGraphToJsonl } from "./jsonl.js";

// The post-cutover rollback path (plan-review round 1, finding #2): a
// kill-switch trip after cutover can't fall back to the pre-cutover JSONL —
// it's stale by every write since. This dump runs the importer backwards,
// producing a fresh JSONL that becomes authoritative again on rollback.
export async function reverseDumpToJsonl(
  databaseUrl: string,
  jsonlPath: string,
): Promise<{ entities: number; relations: number }> {
  const pool = createPool(databaseUrl);
  try {
    const graph = await new KnowledgeGraphStore(pool).readGraph();
    await writeGraphToJsonl(jsonlPath, graph);
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
      "usage: DATABASE_URL=... tsx src/migrate/reverseDump.ts <output-jsonl-path>",
    );
    process.exit(1);
  }
  const counts = await reverseDumpToJsonl(databaseUrl, jsonlPath);
  console.log(
    `dumped ${counts.entities} entities, ${counts.relations} relations to ${jsonlPath}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
