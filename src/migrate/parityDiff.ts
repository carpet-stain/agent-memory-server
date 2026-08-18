import { createPool } from "../db/pool.js";
import { KnowledgeGraphStore } from "../db/store.js";
import { diffGraphs, isIdentical } from "./diff.js";
import { readGraphFromJsonl } from "./jsonl.js";

// The freeze-point verify predicate (plan-review round 1, finding #5): a
// quiesced bidirectional diff between the JSONL file and the live store.
// Only meaningful once the source (stdio server / session entry point) is
// frozen — a diff taken while either side can still change proves nothing.
export async function parityDiff(jsonlPath: string, databaseUrl: string) {
  const pool = createPool(databaseUrl);
  try {
    const [jsonlGraph, pgGraph] = await Promise.all([
      readGraphFromJsonl(jsonlPath),
      new KnowledgeGraphStore(pool).readGraph(),
    ]);
    return diffGraphs(jsonlGraph, pgGraph);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const jsonlPath = process.argv[2];
  const databaseUrl = process.env.DATABASE_URL;
  if (!jsonlPath || !databaseUrl) {
    console.error(
      "usage: DATABASE_URL=... tsx src/migrate/parityDiff.ts <path-to-jsonl>",
    );
    process.exit(1);
  }
  const diff = await parityDiff(jsonlPath, databaseUrl);
  if (isIdentical(diff)) {
    console.log("parity: identical");
    return;
  }
  console.error("parity: diverged");
  console.error("only in JSONL:", JSON.stringify(diff.onlyInFirst, null, 2));
  console.error(
    "only in Postgres:",
    JSON.stringify(diff.onlyInSecond, null, 2),
  );
  process.exit(1);
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
