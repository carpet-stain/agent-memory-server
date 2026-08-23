import { createBearerTokenRefresher, loadRoleCredentials } from "./config.js";
import { RoleRegistry } from "./registry.js";
import { createApp } from "./server.js";

async function main(): Promise<void> {
  const credentials = await loadRoleCredentials();
  const registry = await RoleRegistry.create(credentials, {
    refreshTokens: createBearerTokenRefresher(),
  });
  const app = createApp(registry);

  // Cloud Run injects PORT; 8080 is its own documented default.
  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, () => {
    console.log(`agent-memory-server listening on :${port}`);
  });
}

main().catch((err: unknown) => {
  console.error("fatal error during startup", err);
  process.exit(1);
});
