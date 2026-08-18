import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeGraphStore } from "../src/db/store.js";
import { freshPool, requireTestDatabaseUrl } from "./helpers.js";

// Acceptance criterion (#634): "No lost write under concurrency" — two
// same-role sessions on independent Postgres connections issuing
// overlapping observation writes must not lose an update. A shared
// connection pool would serialize in-process and never exercise the
// advisory lock (plan-review round 2, non-blocking finding) — each writer
// here gets its own Pool, i.e. its own physical connection(s).
describe("concurrent writers under pg_advisory_xact_lock", () => {
  let seedPool: Pool;
  let writerA: Pool;
  let writerB: Pool;

  afterEach(async () => {
    await Promise.all([seedPool?.end(), writerA?.end(), writerB?.end()]);
  });

  it("loses no observation when two independent connections write to the same entity concurrently", async () => {
    seedPool = await freshPool();
    const seedStore = new KnowledgeGraphStore(seedPool);
    await seedStore.createEntities([
      { name: "contested-entity", entityType: "project", observations: [] },
    ]);

    writerA = new Pool({ connectionString: requireTestDatabaseUrl() });
    writerB = new Pool({ connectionString: requireTestDatabaseUrl() });
    const storeA = new KnowledgeGraphStore(writerA);
    const storeB = new KnowledgeGraphStore(writerB);

    // Each writer issues many separate add_observations calls with unique
    // content, concurrently with the other writer. Without the lock, each
    // call's read (of the entity's current observations) can race the
    // other writer's write, causing the read-modify-write in
    // addObservations to silently drop an addition. 25-per-side gives the
    // race many chances to manifest if the lock isn't actually serializing.
    const ROUNDS = 25;
    const writeAll = (store: KnowledgeGraphStore, label: string) =>
      Promise.all(
        Array.from({ length: ROUNDS }, (_, i) =>
          store.addObservations([
            { entityName: "contested-entity", contents: [`${label}-${i}`] },
          ]),
        ),
      );

    await Promise.all([
      writeAll(storeA, "writer-a"),
      writeAll(storeB, "writer-b"),
    ]);

    const graph = await seedStore.readGraph();
    const observations = graph.entities[0]?.observations ?? [];
    const expected = [
      ...Array.from({ length: ROUNDS }, (_, i) => `writer-a-${i}`),
      ...Array.from({ length: ROUNDS }, (_, i) => `writer-b-${i}`),
    ];
    expect(new Set(observations)).toEqual(new Set(expected));
    // Every addition landed exactly once — the lock serialized the writes
    // rather than merely avoiding loss through accidental duplication.
    expect(observations).toHaveLength(expected.length);
  });
});
