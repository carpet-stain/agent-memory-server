import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { type AuthedRequest, bearerAuth } from "./auth.js";
import type { RoleRegistry } from "./registry.js";
import { registerTools } from "./tools.js";

const SERVER_VERSION = "0.1.0";

export function createApp(registry: RoleRegistry): express.Express {
  const app = express();
  app.use(express.json());

  // Unauthenticated — Cloud Run's own startup/liveness probe target.
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post("/mcp", bearerAuth(registry), async (req: AuthedRequest, res) => {
    const roleContext = req.roleContext;
    if (!roleContext) {
      // bearerAuth always sets this before calling next(); a missing
      // roleContext here means the middleware chain was bypassed, not a
      // client-input case — fail loud rather than serve one role's store to
      // another's request.
      res.status(500).json({ error: "no role context resolved" });
      return;
    }

    // One McpServer + transport per request, sessionIdGenerator undefined
    // (stateless mode): no in-memory session state to keep consistent
    // across Cloud Run's horizontally-scaled, scale-to-zero instances —
    // every mutation's real serialization point is the store's advisory
    // lock, not this transport.
    const server = new McpServer({
      name: "agent-memory-server",
      version: SERVER_VERSION,
    });
    registerTools(server, roleContext.store);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return app;
}
