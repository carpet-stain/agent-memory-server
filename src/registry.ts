import type { RoleCredential } from "./config.js";
import { createPool, ensureSchema } from "./db/pool.js";
import { KnowledgeGraphStore } from "./db/store.js";

export interface RoleContext {
  role: string;
  store: KnowledgeGraphStore;
}

// Built once at boot from RoleCredential[] — one Pool per role's database,
// held open for the process lifetime, and a bearer-token lookup that never
// touches Postgres or SSM per-request (infra#240: cache secrets once at
// container boot, cold p95 is what the kill-switch gates).
export class RoleRegistry {
  private readonly byToken = new Map<string, RoleContext>();

  private constructor() {}

  static async create(credentials: RoleCredential[]): Promise<RoleRegistry> {
    const registry = new RoleRegistry();
    for (const cred of credentials) {
      const pool = createPool(cred.databaseUrl);
      await ensureSchema(pool);
      const ctx: RoleContext = {
        role: cred.role,
        store: new KnowledgeGraphStore(pool),
      };
      for (const token of cred.bearerTokens) {
        registry.byToken.set(token, ctx);
      }
    }
    return registry;
  }

  resolve(bearerToken: string): RoleContext | undefined {
    return this.byToken.get(bearerToken);
  }
}
