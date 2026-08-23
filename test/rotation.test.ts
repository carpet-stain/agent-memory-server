import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCredential } from "../src/config.js";
import { RoleRegistry } from "../src/registry.js";
import { createApp } from "../src/server.js";
import { freshPool, requireTestDatabaseUrl } from "./helpers.js";

// Acceptance (#32): an in-flight session survives a rotation without losing
// writes, and a token past its overlap gets a clean 401 — never a silent
// no-op write. Full stack: real MCP client over HTTP against the real
// store, with the token source rotated under the open session.
describe("bearer rotation across an open MCP session", () => {
  const TOKEN_A = "token-a-minted-first";
  const TOKEN_B = "token-b-minted-by-rotation";
  const ROLE = "backlog-manager";

  let currentTokens: string[] = [TOKEN_A];
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    await (await freshPool()).end();
    const credentials: RoleCredential[] = [
      {
        role: ROLE,
        bearerTokens: currentTokens,
        databaseUrl: requireTestDatabaseUrl(),
      },
    ];
    // TTL/cooldown 0: every request revalidates against the source, so a
    // rotation is visible immediately — the prod lag is minutes (ADR-0003).
    const registry = await RoleRegistry.create(credentials, {
      refreshTokens: async () => new Map([[ROLE, currentTokens]]),
      cacheTtlMs: 0,
      refreshCooldownMs: 0,
    });
    server = createApp(registry).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a TCP address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  async function connect(token: string): Promise<Client> {
    const client = new Client({ name: "rotation-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  }

  async function createEntity(client: Client, name: string): Promise<void> {
    const result = await client.callTool({
      name: "create_entities",
      arguments: {
        entities: [{ name, entityType: "reference", observations: [] }],
      },
    });
    expect(result.isError ?? false).toBe(false);
  }

  it("keeps an open session writing through a rotation, then 401s past the overlap", async () => {
    const session = await connect(TOKEN_A);
    await createEntity(session, "written-before-rotation");

    // Rotation: B minted, A retained for the overlap.
    currentTokens = [TOKEN_B, TOKEN_A];
    await createEntity(session, "written-during-overlap");

    // A rotation-minted token works with no server restart.
    const newSession = await connect(TOKEN_B);
    await createEntity(newSession, "written-with-new-token");

    // Overlap over: A drops out of the set. The open session gets an
    // explicit auth failure, not a silent no-op.
    currentTokens = [TOKEN_B];
    await expect(createEntity(session, "must-not-be-written")).rejects.toThrow(
      /invalid bearer token/,
    );

    // Every accepted write landed; the rejected one didn't.
    const graph = await newSession.callTool({
      name: "read_graph",
      arguments: {},
    });
    const names = (
      graph.structuredContent as {
        entities: { name: string }[];
      }
    ).entities.map((e) => e.name);
    expect(names).toContain("written-before-rotation");
    expect(names).toContain("written-during-overlap");
    expect(names).toContain("written-with-new-token");
    expect(names).not.toContain("must-not-be-written");

    await session.close();
    await newSession.close();
  });
});
