import { z } from "zod";

// ADR-0033's four pointer types plus `repo-map`, the structural per-repo
// hook entity carpet-stain/agents' backlog-manager.md documents — narrower
// than the reference server's free-text entityType, since this store only
// ever holds the semantic tier.
export const EntityTypeSchema = z.enum([
  "project",
  "reference",
  "user",
  "feedback",
  "repo-map",
]);

export const EntitySchema = z.object({
  name: z.string(),
  entityType: EntityTypeSchema,
  observations: z.array(z.string()),
});
export type Entity = z.infer<typeof EntitySchema>;

export const RelationSchema = z.object({
  from: z.string(),
  to: z.string(),
  relationType: z.string(),
});
export type Relation = z.infer<typeof RelationSchema>;

export interface Graph {
  entities: Entity[];
  relations: Relation[];
}

export interface ObservationAddition {
  entityName: string;
  contents: string[];
}

export interface ObservationAdditionResult {
  entityName: string;
  addedObservations: string[];
}

export interface ObservationDeletion {
  entityName: string;
  observations: string[];
}
