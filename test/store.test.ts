import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KnowledgeGraphStore } from "../src/db/store.js";
import { freshPool } from "./helpers.js";

describe("KnowledgeGraphStore", () => {
  let pool: Pool;
  let store: KnowledgeGraphStore;

  beforeEach(async () => {
    pool = await freshPool();
    store = new KnowledgeGraphStore(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("creates entities and skips ones that already exist", async () => {
    await store.createEntities([
      { name: "a", entityType: "project", observations: ["first"] },
    ]);
    const created = await store.createEntities([
      { name: "a", entityType: "project", observations: ["duplicate-attempt"] },
      { name: "b", entityType: "reference", observations: [] },
    ]);
    expect(created).toEqual([
      { name: "b", entityType: "reference", observations: [] },
    ]);

    const graph = await store.readGraph();
    expect(graph.entities).toEqual([
      { name: "a", entityType: "project", observations: ["first"] },
      { name: "b", entityType: "reference", observations: [] },
    ]);
  });

  it("creates relations and skips duplicates", async () => {
    const created = await store.createRelations([
      { from: "a", to: "b", relationType: "relates-to" },
    ]);
    expect(created).toEqual([
      { from: "a", to: "b", relationType: "relates-to" },
    ]);
    const secondAttempt = await store.createRelations([
      { from: "a", to: "b", relationType: "relates-to" },
    ]);
    expect(secondAttempt).toEqual([]);
  });

  it("adds only new observations and reports what was added", async () => {
    await store.createEntities([
      { name: "a", entityType: "project", observations: ["x"] },
    ]);
    const result = await store.addObservations([
      { entityName: "a", contents: ["x", "y"] },
    ]);
    expect(result).toEqual([{ entityName: "a", addedObservations: ["y"] }]);
    const graph = await store.readGraph();
    expect(graph.entities[0]?.observations).toEqual(["x", "y"]);
  });

  it("throws and rolls back the whole call when an entity is missing", async () => {
    await store.createEntities([
      { name: "a", entityType: "project", observations: [] },
    ]);
    await expect(
      store.addObservations([
        { entityName: "a", contents: ["ok"] },
        { entityName: "missing", contents: ["nope"] },
      ]),
    ).rejects.toThrow("Entity with name missing not found");

    const graph = await store.readGraph();
    expect(graph.entities[0]?.observations).toEqual([]); // the 'a' write never committed
  });

  it("deleting an entity cascades its relations", async () => {
    await store.createEntities([
      { name: "a", entityType: "project", observations: [] },
      { name: "b", entityType: "project", observations: [] },
    ]);
    await store.createRelations([
      { from: "a", to: "b", relationType: "relates-to" },
    ]);
    await store.deleteEntities(["a"]);
    const graph = await store.readGraph();
    expect(graph.entities.map((e) => e.name)).toEqual(["b"]);
    expect(graph.relations).toEqual([]);
  });

  it("leaves a dangling relation when only the entity on one end is deleted via a separate call", async () => {
    // Plan-review round 2: no FK between relations and entities — a
    // per-transaction lock still lets create_relations/delete_entities
    // dangle a relation across separate calls, matching the reference
    // server's own behavior.
    await store.createEntities([
      { name: "a", entityType: "project", observations: [] },
      { name: "b", entityType: "project", observations: [] },
    ]);
    await store.createRelations([
      { from: "a", to: "b", relationType: "relates-to" },
    ]);
    await store.deleteEntities(["a"]);
    // deleteEntities itself always cascades relations touching its own
    // argument — the dangling case is a relation created *after* one
    // endpoint no longer exists, which the store never rejects.
    await store.createRelations([
      { from: "a", to: "b", relationType: "relates-to-again" },
    ]);
    const graph = await store.readGraph();
    expect(graph.relations).toEqual([
      { from: "a", to: "b", relationType: "relates-to-again" },
    ]);
    expect(graph.entities.map((e) => e.name)).toEqual(["b"]);
  });

  it("deletes specific observations", async () => {
    await store.createEntities([
      { name: "a", entityType: "project", observations: ["x", "y", "z"] },
    ]);
    await store.deleteObservations([{ entityName: "a", observations: ["y"] }]);
    const graph = await store.readGraph();
    expect(graph.entities[0]?.observations.sort()).toEqual(["x", "z"]);
  });

  it("deletes specific relations by exact match", async () => {
    await store.createRelations([
      { from: "a", to: "b", relationType: "relates-to" },
      { from: "a", to: "c", relationType: "relates-to" },
    ]);
    await store.deleteRelations([
      { from: "a", to: "b", relationType: "relates-to" },
    ]);
    const graph = await store.readGraph();
    expect(graph.relations).toEqual([
      { from: "a", to: "c", relationType: "relates-to" },
    ]);
  });

  it("search_nodes matches name, type, or observation substrings and includes touching relations", async () => {
    await store.createEntities([
      {
        name: "apples-supplier",
        entityType: "project",
        observations: ["ships oranges too"],
      },
      { name: "unrelated", entityType: "reference", observations: [] },
    ]);
    await store.createRelations([
      { from: "apples-supplier", to: "unrelated", relationType: "ships-to" },
    ]);

    const byObservation = await store.searchNodes("oranges");
    expect(byObservation.entities.map((e) => e.name)).toEqual([
      "apples-supplier",
    ]);
    // Either endpoint matching, not both — lets a match surface its
    // connection to a node outside the search hit set.
    expect(byObservation.relations).toEqual([
      { from: "apples-supplier", to: "unrelated", relationType: "ships-to" },
    ]);
  });

  it("open_nodes returns exact-name matches plus relations touching them", async () => {
    await store.createEntities([
      { name: "a", entityType: "project", observations: [] },
      { name: "b", entityType: "project", observations: [] },
      { name: "c", entityType: "project", observations: [] },
    ]);
    await store.createRelations([
      { from: "a", to: "c", relationType: "relates-to" },
    ]);

    const opened = await store.openNodes(["a"]);
    expect(opened.entities.map((e) => e.name)).toEqual(["a"]);
    expect(opened.relations).toEqual([
      { from: "a", to: "c", relationType: "relates-to" },
    ]);
  });
});
