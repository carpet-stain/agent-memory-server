import { createHash, timingSafeEqual } from "node:crypto";
import type { RoleCredential } from "./config.js";
import { createPool } from "./db/pool.js";
import { KnowledgeGraphStore } from "./db/store.js";

export interface RoleContext {
  role: string;
  store: KnowledgeGraphStore;
}

// Re-fetches the currently-valid bearer set (role → tokens) from wherever
// this deployment's secrets live. Undefined means the set is static for the
// process lifetime (local/test env-var mode).
export type BearerTokenSource = () => Promise<Map<string, string[]>>;

export interface RegistryOptions {
  refreshTokens?: BearerTokenSource;
  // Both cadences: ADR-0003. TTL bounds how long a rotated-out token keeps
  // matching the cached set; cooldown stops unknown-token spam from turning
  // the miss path into per-request SSM reads (infra#240).
  cacheTtlMs?: number;
  refreshCooldownMs?: number;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_REFRESH_COOLDOWN_MS = 30_000;

interface TokenEntry {
  digest: Buffer;
  ctx: RoleContext;
}

function digestToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

// Built once at boot from RoleCredential[] — one Pool per role's database,
// held open for the process lifetime. The role set is fixed at boot; only
// the bearer set is mutable, re-read from the token source on a short TTL
// and on an unknown token, so a rotation (issue #32) reaches running
// instances without a redeploy while the hot path stays boot-cached
// (infra#240: cold p95 is what the kill-switch gates).
export class RoleRegistry {
  private readonly byRole = new Map<string, RoleContext>();
  private entries: TokenEntry[] = [];
  private readonly refreshTokens?: BearerTokenSource;
  private readonly cacheTtlMs: number;
  private readonly refreshCooldownMs: number;
  private lastRefreshMs = 0;
  private inflightRefresh?: Promise<void>;

  private constructor(options: RegistryOptions) {
    this.refreshTokens = options.refreshTokens;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.refreshCooldownMs =
      options.refreshCooldownMs ?? DEFAULT_REFRESH_COOLDOWN_MS;
  }

  static async create(
    credentials: RoleCredential[],
    options: RegistryOptions = {},
  ): Promise<RoleRegistry> {
    const registry = new RoleRegistry(options);
    for (const cred of credentials) {
      // No ensureSchema here: schema DDL is CI-owned, run as `owner` in the
      // apply workflows — `app` can't (and must never) CREATE (ADR-0002 D5).
      const pool = createPool(cred.databaseUrl);
      const ctx: RoleContext = {
        role: cred.role,
        store: new KnowledgeGraphStore(pool),
      };
      registry.byRole.set(cred.role, ctx);
      for (const token of cred.bearerTokens) {
        registry.entries.push({ digest: digestToken(token), ctx });
      }
    }
    registry.lastRefreshMs = Date.now();
    return registry;
  }

  async resolve(bearerToken: string): Promise<RoleContext | undefined> {
    await this.refreshIfOlderThan(this.cacheTtlMs);
    const hit = this.match(bearerToken);
    if (hit) {
      return hit;
    }
    // Unknown token: maybe minted by a rotation newer than the cache —
    // re-read (cooldown-limited) and retry before rejecting.
    await this.refreshIfOlderThan(this.refreshCooldownMs);
    return this.match(bearerToken);
  }

  // Compares against every entry — no early exit on first match or
  // mismatch, and each comparison is timingSafeEqual over fixed-length
  // sha256 digests, so response time doesn't leak how much of a candidate
  // token matched (issue #32).
  private match(bearerToken: string): RoleContext | undefined {
    const candidate = digestToken(bearerToken);
    let matched: RoleContext | undefined;
    for (const entry of this.entries) {
      if (timingSafeEqual(candidate, entry.digest) && matched === undefined) {
        matched = entry.ctx;
      }
    }
    return matched;
  }

  private async refreshIfOlderThan(maxAgeMs: number): Promise<void> {
    if (!this.refreshTokens) {
      return;
    }
    if (this.inflightRefresh) {
      await this.inflightRefresh;
      return;
    }
    if (Date.now() - this.lastRefreshMs < maxAgeMs) {
      return;
    }
    this.inflightRefresh = this.doRefresh();
    try {
      await this.inflightRefresh;
    } finally {
      this.inflightRefresh = undefined;
    }
  }

  private async doRefresh(): Promise<void> {
    if (!this.refreshTokens) {
      return;
    }
    let byRole: Map<string, string[]>;
    try {
      byRole = await this.refreshTokens();
    } catch (err) {
      // Keep serving the cached set: failing every request because the
      // secret store blipped is worse than a rotated-out token living one
      // extra TTL. The lag this tolerates is minutes against a days-long
      // overlap (ADR-0003).
      console.error("bearer token refresh failed, keeping cached set", err);
      this.lastRefreshMs = Date.now();
      return;
    }
    const entries: TokenEntry[] = [];
    for (const [role, tokens] of byRole) {
      const ctx = this.byRole.get(role);
      if (!ctx) {
        // Roles (and their pools) are fixed at boot — a new role needs a
        // deploy, not a token refresh.
        console.error(`token refresh returned unknown role ${role}, ignoring`);
        continue;
      }
      for (const token of tokens) {
        entries.push({ digest: digestToken(token), ctx });
      }
    }
    this.entries = entries;
    this.lastRefreshMs = Date.now();
  }
}
