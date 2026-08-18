import type { Pool, PoolClient } from "pg";
import type {
  Entity,
  Graph,
  ObservationAddition,
  ObservationAdditionResult,
  ObservationDeletion,
  Relation,
} from "../types.js";

// Constant per store/db (ADR-0046 plan-review round 2): one Neon database per
// agent, so a single key serializes every mutation against this store
// regardless of how many Cloud Run instances are running.
const STORE_LOCK_KEY = 1;

// Bounded slice for search_nodes — the reference server has no limit; this
// store never returns an unbounded scan.
const SEARCH_LIMIT = 200;

interface EntityRow {
  name: string;
  entity_type: Entity["entityType"];
  observations: string[];
}

interface RelationRow {
  from_entity: string;
  to_entity: string;
  relation_type: string;
}

function rowToEntity(row: EntityRow): Entity {
  return {
    name: row.name,
    entityType: row.entity_type,
    observations: row.observations,
  };
}

function rowToRelation(row: RelationRow): Relation {
  return {
    from: row.from_entity,
    to: row.to_entity,
    relationType: row.relation_type,
  };
}

// The Postgres-backed twin of the reference server's in-memory
// KnowledgeGraphManager — same method contracts (filter-out-existing on
// create, throw-on-missing-entity for add_observations, always-succeed
// deletes), but every mutation runs as one transaction under
// pg_advisory_xact_lock instead of a whole-file load/mutate/save.
export class KnowledgeGraphStore {
  constructor(private readonly pool: Pool) {}

  private async withLock<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [STORE_LOCK_KEY]);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async readGraph(): Promise<Graph> {
    const client = await this.pool.connect();
    try {
      const entities = await client.query<EntityRow>(
        "SELECT name, entity_type, observations FROM entities ORDER BY name",
      );
      const relations = await client.query<RelationRow>(
        "SELECT from_entity, to_entity, relation_type FROM relations ORDER BY from_entity, to_entity, relation_type",
      );
      return {
        entities: entities.rows.map(rowToEntity),
        relations: relations.rows.map(rowToRelation),
      };
    } finally {
      client.release();
    }
  }

  async createEntities(entities: Entity[]): Promise<Entity[]> {
    return this.withLock(async (client) => {
      const created: Entity[] = [];
      for (const entity of entities) {
        const result = await client.query(
          `INSERT INTO entities (name, entity_type, observations)
           VALUES ($1, $2, $3)
           ON CONFLICT (name) DO NOTHING
           RETURNING name`,
          [entity.name, entity.entityType, entity.observations],
        );
        if (result.rowCount) created.push(entity);
      }
      return created;
    });
  }

  async createRelations(relations: Relation[]): Promise<Relation[]> {
    return this.withLock(async (client) => {
      const created: Relation[] = [];
      for (const relation of relations) {
        const result = await client.query(
          `INSERT INTO relations (from_entity, to_entity, relation_type)
           VALUES ($1, $2, $3)
           ON CONFLICT (from_entity, to_entity, relation_type) DO NOTHING
           RETURNING from_entity`,
          [relation.from, relation.to, relation.relationType],
        );
        if (result.rowCount) created.push(relation);
      }
      return created;
    });
  }

  async addObservations(
    observations: ObservationAddition[],
  ): Promise<ObservationAdditionResult[]> {
    return this.withLock(async (client) => {
      const results: ObservationAdditionResult[] = [];
      for (const o of observations) {
        const existing = await client.query<{ observations: string[] }>(
          "SELECT observations FROM entities WHERE name = $1",
          [o.entityName],
        );
        const row = existing.rows[0];
        if (!row) {
          // Throwing here rolls back the whole transaction (withLock's
          // catch), so any earlier entries in this same call never persist
          // — matches the reference server's all-or-nothing per-call
          // behavior, which builds the whole result array in memory before
          // its single save.
          throw new Error(`Entity with name ${o.entityName} not found`);
        }
        const added = o.contents.filter((c) => !row.observations.includes(c));
        if (added.length) {
          // Full-array replace (read row.observations, append in JS, write
          // the whole array back) rather than a SQL `||` append — this is
          // the genuine read-modify-write the advisory lock exists to
          // serialize: two transactions both reading the pre-add array
          // would each compute their own addition and the later UPDATE
          // would silently overwrite the earlier one without it. See
          // test/concurrency.test.ts.
          const merged = [...row.observations, ...added];
          await client.query(
            "UPDATE entities SET observations = $2 WHERE name = $1",
            [o.entityName, merged],
          );
        }
        results.push({ entityName: o.entityName, addedObservations: added });
      }
      return results;
    });
  }

  async deleteEntities(entityNames: string[]): Promise<void> {
    await this.withLock(async (client) => {
      await client.query(
        "DELETE FROM relations WHERE from_entity = ANY($1) OR to_entity = ANY($1)",
        [entityNames],
      );
      await client.query("DELETE FROM entities WHERE name = ANY($1)", [
        entityNames,
      ]);
    });
  }

  async deleteObservations(deletions: ObservationDeletion[]): Promise<void> {
    await this.withLock(async (client) => {
      for (const d of deletions) {
        await client.query(
          `UPDATE entities
           SET observations = (
             SELECT coalesce(array_agg(o), '{}') FROM unnest(observations) AS o WHERE NOT (o = ANY ($2))
           )
           WHERE name = $1`,
          [d.entityName, d.observations],
        );
      }
    });
  }

  async deleteRelations(relations: Relation[]): Promise<void> {
    await this.withLock(async (client) => {
      for (const r of relations) {
        await client.query(
          "DELETE FROM relations WHERE from_entity = $1 AND to_entity = $2 AND relation_type = $3",
          [r.from, r.to, r.relationType],
        );
      }
    });
  }

  async searchNodes(query: string): Promise<Graph> {
    const client = await this.pool.connect();
    try {
      const pattern = `%${query}%`;
      const entities = await client.query<EntityRow>(
        `SELECT name, entity_type, observations FROM entities
         WHERE name ILIKE $1 OR entity_type ILIKE $1
            OR EXISTS (SELECT 1 FROM unnest(observations) AS o WHERE o ILIKE $1)
         ORDER BY name
         LIMIT $2`,
        [pattern, SEARCH_LIMIT],
      );
      return {
        entities: entities.rows.map(rowToEntity),
        relations: await this.relationsTouching(
          client,
          entities.rows.map((r) => r.name),
        ),
      };
    } finally {
      client.release();
    }
  }

  async openNodes(names: string[]): Promise<Graph> {
    const client = await this.pool.connect();
    try {
      const entities = await client.query<EntityRow>(
        "SELECT name, entity_type, observations FROM entities WHERE name = ANY($1) ORDER BY name",
        [names],
      );
      return {
        entities: entities.rows.map(rowToEntity),
        relations: await this.relationsTouching(client, names),
      };
    } finally {
      client.release();
    }
  }

  // Either endpoint matching (not both) is deliberate — mirrors the
  // reference server's open_nodes fix that let callers discover a
  // requested/matched node's connections to nodes outside the result set.
  private async relationsTouching(
    client: PoolClient,
    names: string[],
  ): Promise<Relation[]> {
    if (names.length === 0) return [];
    const result = await client.query<RelationRow>(
      "SELECT from_entity, to_entity, relation_type FROM relations WHERE from_entity = ANY($1) OR to_entity = ANY($1)",
      [names],
    );
    return result.rows.map(rowToRelation);
  }
}
