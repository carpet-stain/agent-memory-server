import type { Entity, Graph, Relation } from "../types.js";

// Canonical, order-independent keys — the migration verify step and the
// round-trip identity test both need "same graph" to mean the same set of
// entities/relations, not the same array order (Postgres's ORDER BY name
// and the JSONL file's original append order have no reason to agree).
function entityKey(e: Entity): string {
  return JSON.stringify([e.name, e.entityType, [...e.observations].sort()]);
}

function relationKey(r: Relation): string {
  return JSON.stringify([r.from, r.to, r.relationType]);
}

export interface GraphDiff {
  onlyInFirst: { entities: Entity[]; relations: Relation[] };
  onlyInSecond: { entities: Entity[]; relations: Relation[] };
}

export function diffGraphs(first: Graph, second: Graph): GraphDiff {
  const firstEntityKeys = new Map(first.entities.map((e) => [entityKey(e), e]));
  const secondEntityKeys = new Map(
    second.entities.map((e) => [entityKey(e), e]),
  );
  const firstRelationKeys = new Map(
    first.relations.map((r) => [relationKey(r), r]),
  );
  const secondRelationKeys = new Map(
    second.relations.map((r) => [relationKey(r), r]),
  );

  return {
    onlyInFirst: {
      entities: [...firstEntityKeys.entries()]
        .filter(([k]) => !secondEntityKeys.has(k))
        .map(([, e]) => e),
      relations: [...firstRelationKeys.entries()]
        .filter(([k]) => !secondRelationKeys.has(k))
        .map(([, r]) => r),
    },
    onlyInSecond: {
      entities: [...secondEntityKeys.entries()]
        .filter(([k]) => !firstEntityKeys.has(k))
        .map(([, e]) => e),
      relations: [...secondRelationKeys.entries()]
        .filter(([k]) => !firstRelationKeys.has(k))
        .map(([, r]) => r),
    },
  };
}

export function isIdentical(diff: GraphDiff): boolean {
  return (
    diff.onlyInFirst.entities.length === 0 &&
    diff.onlyInFirst.relations.length === 0 &&
    diff.onlyInSecond.entities.length === 0 &&
    diff.onlyInSecond.relations.length === 0
  );
}
