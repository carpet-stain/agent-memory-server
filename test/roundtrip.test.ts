import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diffGraphs, isIdentical } from "../src/migrate/diff.js";
import { importJsonlToPostgres } from "../src/migrate/import.js";
import { readGraphFromJsonl, writeGraphToJsonl } from "../src/migrate/jsonl.js";
import { parityDiff } from "../src/migrate/parityDiff.js";
import { reverseDumpToJsonl } from "../src/migrate/reverseDump.js";
import type { Graph } from "../src/types.js";
import { requireTestDatabaseUrl } from "./helpers.js";

// Acceptance criterion (#634): "Round-trip identity: JSONL→Postgres→JSONL
// parity, same rigor as the migration diff — proves the reverse-dump
// rollback is safe." If this ever fails, the post-cutover kill-switch's
// rollback path (dotfiles ADR-0046) silently loses or corrupts data.
describe("JSONL -> Postgres -> JSONL round trip", () => {
  let dir: string;
  let sourcePath: string;
  let dumpedPath: string;
  const databaseUrl = requireTestDatabaseUrl();

  const SAMPLE_GRAPH: Graph = {
    entities: [
      {
        name: "backlog-manager",
        entityType: "user",
        observations: ["triages the GitHub backlog"],
      },
      {
        name: "adr-0046",
        entityType: "reference",
        observations: ["hosted memory design"],
      },
      {
        name: "no-observations-entity",
        entityType: "project",
        observations: [],
      },
      { name: "dangling-target", entityType: "reference", observations: [] },
    ],
    relations: [
      { from: "backlog-manager", to: "adr-0046", relationType: "implements" },
      // A relation whose target isn't in `entities` at all — the store has
      // no FK (plan-review round 2), and the migration/dump path must carry
      // this exactly as-is, not drop or repair it.
      { from: "adr-0046", to: "orphan-target", relationType: "supersedes" },
    ],
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agent-memory-roundtrip-"));
    sourcePath = join(dir, "source.jsonl");
    dumpedPath = join(dir, "dumped.jsonl");
    await writeGraphToJsonl(sourcePath, SAMPLE_GRAPH);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("produces a JSONL file identical (as unordered sets) to the original after import + reverse dump", async () => {
    await importJsonlToPostgres(sourcePath, databaseUrl);

    const midMigrationDiff = await parityDiff(sourcePath, databaseUrl);
    expect(isIdentical(midMigrationDiff)).toBe(true);

    await reverseDumpToJsonl(databaseUrl, dumpedPath);

    const original = await readGraphFromJsonl(sourcePath);
    const roundTripped = await readGraphFromJsonl(dumpedPath);
    const diff = diffGraphs(original, roundTripped);
    expect(diff).toEqual({
      onlyInFirst: { entities: [], relations: [] },
      onlyInSecond: { entities: [], relations: [] },
    });
    expect(isIdentical(diff)).toBe(true);
  });
});
