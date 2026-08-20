import { fileURLToPath } from "node:url";

export function main(): void {
  console.log("Hello from the TypeScript starter!");
}

// Run only as an entry point (`pnpm start`), not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
