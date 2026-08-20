import { expect, test, vi } from "vitest";

import { main } from "../src/index.js";

test("main prints a greeting", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  main();
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});
