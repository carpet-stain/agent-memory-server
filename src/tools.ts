import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { KnowledgeGraphStore } from "./db/store.js";
import { EntitySchema, RelationSchema } from "./types.js";

// The 9-tool semantic surface, mirroring @modelcontextprotocol/server-memory
// (the reference server this replaces) tool-for-tool — same names,
// input/output shapes, and annotations — so no MCP client needs to change
// how it calls memory, only where. The one deliberate divergence is
// EntitySchema.entityType, narrowed to ADR-0033's four pointer types.
export function registerTools(
  server: McpServer,
  store: KnowledgeGraphStore,
): void {
  server.registerTool(
    "create_entities",
    {
      title: "Create Entities",
      description: "Create multiple new entities in the knowledge graph",
      inputSchema: { entities: z.array(EntitySchema) },
      outputSchema: { entities: z.array(EntitySchema) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ entities }) => {
      const result = await store.createEntities(entities);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { entities: result },
      };
    },
  );

  server.registerTool(
    "create_relations",
    {
      title: "Create Relations",
      description:
        "Create multiple new relations between entities in the knowledge graph. Relations should be in active voice",
      inputSchema: { relations: z.array(RelationSchema) },
      outputSchema: { relations: z.array(RelationSchema) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ relations }) => {
      const result = await store.createRelations(relations);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { relations: result },
      };
    },
  );

  server.registerTool(
    "add_observations",
    {
      title: "Add Observations",
      description:
        "Add new observations to existing entities in the knowledge graph",
      inputSchema: {
        observations: z.array(
          z.object({
            entityName: z
              .string()
              .describe("The name of the entity to add the observations to"),
            contents: z
              .array(z.string())
              .describe("An array of observation contents to add"),
          }),
        ),
      },
      outputSchema: {
        results: z.array(
          z.object({
            entityName: z.string(),
            addedObservations: z.array(z.string()),
          }),
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ observations }) => {
      const result = await store.addObservations(observations);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { results: result },
      };
    },
  );

  server.registerTool(
    "delete_entities",
    {
      title: "Delete Entities",
      description:
        "Delete multiple entities and their associated relations from the knowledge graph",
      inputSchema: {
        entityNames: z
          .array(z.string())
          .describe("An array of entity names to delete"),
      },
      outputSchema: { success: z.boolean(), message: z.string() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ entityNames }) => {
      await store.deleteEntities(entityNames);
      return {
        content: [{ type: "text", text: "Entities deleted successfully" }],
        structuredContent: {
          success: true,
          message: "Entities deleted successfully",
        },
      };
    },
  );

  server.registerTool(
    "delete_observations",
    {
      title: "Delete Observations",
      description:
        "Delete specific observations from entities in the knowledge graph",
      inputSchema: {
        deletions: z.array(
          z.object({
            entityName: z
              .string()
              .describe("The name of the entity containing the observations"),
            observations: z
              .array(z.string())
              .describe("An array of observations to delete"),
          }),
        ),
      },
      outputSchema: { success: z.boolean(), message: z.string() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ deletions }) => {
      await store.deleteObservations(deletions);
      return {
        content: [{ type: "text", text: "Observations deleted successfully" }],
        structuredContent: {
          success: true,
          message: "Observations deleted successfully",
        },
      };
    },
  );

  server.registerTool(
    "delete_relations",
    {
      title: "Delete Relations",
      description: "Delete multiple relations from the knowledge graph",
      inputSchema: {
        relations: z
          .array(RelationSchema)
          .describe("An array of relations to delete"),
      },
      outputSchema: { success: z.boolean(), message: z.string() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ relations }) => {
      await store.deleteRelations(relations);
      return {
        content: [{ type: "text", text: "Relations deleted successfully" }],
        structuredContent: {
          success: true,
          message: "Relations deleted successfully",
        },
      };
    },
  );

  server.registerTool(
    "read_graph",
    {
      title: "Read Graph",
      description: "Read the entire knowledge graph",
      inputSchema: {},
      outputSchema: {
        entities: z.array(EntitySchema),
        relations: z.array(RelationSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const graph = await store.readGraph();
      return {
        content: [{ type: "text", text: JSON.stringify(graph, null, 2) }],
        structuredContent: { ...graph },
      };
    },
  );

  server.registerTool(
    "search_nodes",
    {
      title: "Search Nodes",
      description: "Search for nodes in the knowledge graph based on a query",
      inputSchema: {
        query: z
          .string()
          .describe(
            "The search query to match against entity names, types, and observation content",
          ),
      },
      outputSchema: {
        entities: z.array(EntitySchema),
        relations: z.array(RelationSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query }) => {
      const graph = await store.searchNodes(query);
      return {
        content: [{ type: "text", text: JSON.stringify(graph, null, 2) }],
        structuredContent: { ...graph },
      };
    },
  );

  server.registerTool(
    "open_nodes",
    {
      title: "Open Nodes",
      description: "Open specific nodes in the knowledge graph by their names",
      inputSchema: {
        names: z
          .array(z.string())
          .describe("An array of entity names to retrieve"),
      },
      outputSchema: {
        entities: z.array(EntitySchema),
        relations: z.array(RelationSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ names }) => {
      const graph = await store.openNodes(names);
      return {
        content: [{ type: "text", text: JSON.stringify(graph, null, 2) }],
        structuredContent: { ...graph },
      };
    },
  );
}
