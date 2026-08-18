import { readFile, writeFile } from "node:fs/promises";
import type { Entity, Graph, Relation } from "../types.js";

// The exact line shape @modelcontextprotocol/server-memory reads and
// writes — one JSON object per line, tagged by `type`. Matching it byte-for-
// byte (not just semantically) is what makes the reverse dump a safe
// rollback target: a session pointed back at stdio+JSONL sees the same file
// shape it always has.
type EntityLine = {
  type: "entity";
  name: string;
  entityType: string;
  observations: string[];
};
type RelationLine = {
  type: "relation";
  from: string;
  to: string;
  relationType: string;
};

export async function readGraphFromJsonl(path: string): Promise<Graph> {
  let data: string;
  try {
    data = await readFile(path, "utf-8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return { entities: [], relations: [] };
    }
    throw err;
  }

  const entities: Entity[] = [];
  const relations: Relation[] = [];
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    const item = JSON.parse(line) as EntityLine | RelationLine;
    if (item.type === "entity") {
      entities.push({
        name: item.name,
        entityType: item.entityType as Entity["entityType"],
        observations: item.observations,
      });
    } else if (item.type === "relation") {
      relations.push({
        from: item.from,
        to: item.to,
        relationType: item.relationType,
      });
    }
  }
  return { entities, relations };
}

export async function writeGraphToJsonl(
  path: string,
  graph: Graph,
): Promise<void> {
  const lines = [
    ...graph.entities.map((e) =>
      JSON.stringify({
        type: "entity",
        name: e.name,
        entityType: e.entityType,
        observations: e.observations,
      }),
    ),
    ...graph.relations.map((r) =>
      JSON.stringify({
        type: "relation",
        from: r.from,
        to: r.to,
        relationType: r.relationType,
      }),
    ),
  ];
  await writeFile(path, lines.join("\n"));
}
