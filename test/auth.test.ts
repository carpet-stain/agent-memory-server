import { describe, expect, it, vi } from "vitest";
import type { RoleCredential } from "../src/config.js";
import { RoleRegistry } from "../src/registry.js";
import { createApp } from "../src/server.js";

// Registry/auth behavior only — no request ever reaches the store, so the
// databaseUrl never connects.
const CREDS: RoleCredential[] = [
  {
    role: "backlog-manager",
    bearerTokens: ["token-current", "token-previous"],
    databaseUrl: "postgres://unused:unused@127.0.0.1:1/unused",
  },
];

describe("RoleRegistry token validation", () => {
  it("accepts every token in the set — the overlap's previous token included", async () => {
    const registry = await RoleRegistry.create(CREDS);
    for (const token of ["token-current", "token-previous"]) {
      const ctx = await registry.resolve(token);
      expect(ctx?.role).toBe("backlog-manager");
    }
    expect(await registry.resolve("token-unknown")).toBeUndefined();
  });

  it("picks up a rotation-minted token via refresh, no restart", async () => {
    const refreshTokens = vi.fn(
      async () =>
        new Map([["backlog-manager", ["token-rotated", "token-current"]]]),
    );
    const registry = await RoleRegistry.create(CREDS, {
      refreshTokens,
      cacheTtlMs: Number.POSITIVE_INFINITY,
      refreshCooldownMs: 0,
    });
    const ctx = await registry.resolve("token-rotated");
    expect(ctx?.role).toBe("backlog-manager");
    expect(refreshTokens).toHaveBeenCalledTimes(1);
  });

  it("rejects a token past its overlap once the set no longer carries it", async () => {
    const refreshTokens = vi.fn(
      async () => new Map([["backlog-manager", ["token-current"]]]),
    );
    const registry = await RoleRegistry.create(CREDS, {
      refreshTokens,
      cacheTtlMs: 0,
      refreshCooldownMs: 0,
    });
    expect(await registry.resolve("token-previous")).toBeUndefined();
    expect((await registry.resolve("token-current"))?.role).toBe(
      "backlog-manager",
    );
  });

  it("does not re-read the source on every unknown token inside the cooldown", async () => {
    const refreshTokens = vi.fn(
      async () => new Map([["backlog-manager", ["token-current"]]]),
    );
    const registry = await RoleRegistry.create(CREDS, {
      refreshTokens,
      cacheTtlMs: Number.POSITIVE_INFINITY,
      refreshCooldownMs: Number.POSITIVE_INFINITY,
    });
    for (let i = 0; i < 5; i++) {
      expect(await registry.resolve(`garbage-${i}`)).toBeUndefined();
    }
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it("keeps serving the cached set when a refresh fails", async () => {
    const refreshTokens = vi
      .fn<() => Promise<Map<string, string[]>>>()
      .mockRejectedValue(new Error("ssm unavailable"));
    const registry = await RoleRegistry.create(CREDS, {
      refreshTokens,
      cacheTtlMs: 0,
      refreshCooldownMs: 0,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await registry.resolve("token-current"))?.role).toBe(
        "backlog-manager",
      );
    } finally {
      errorSpy.mockRestore();
    }
    expect(refreshTokens).toHaveBeenCalled();
  });
});

describe("bearerAuth over HTTP", () => {
  async function withApp(
    registry: RoleRegistry,
    fn: (baseUrl: string) => Promise<void>,
  ): Promise<void> {
    const app = createApp(registry);
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a TCP address");
    }
    try {
      await fn(`http://127.0.0.1:${address.port}`);
    } finally {
      server.close();
    }
  }

  it("401s with an explicit JSON error the client can act on", async () => {
    const registry = await RoleRegistry.create(CREDS);
    await withApp(registry, async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/mcp`, { method: "POST" });
      expect(missing.status).toBe(401);
      expect(await missing.json()).toEqual({ error: "missing bearer token" });

      const invalid = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { authorization: "Bearer token-expired" },
      });
      expect(invalid.status).toBe(401);
      expect(await invalid.json()).toEqual({ error: "invalid bearer token" });
    });
  });
});
