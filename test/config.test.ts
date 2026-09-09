import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config.js";

test("configuration rejects invalid budgets and accidental string booleans", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-config-"));
  const path = join(root, "config.json");
  const models = { planner: { provider: "example", model: "planner" }, worker: { provider: "example", model: "worker" } };
  try {
    await writeFile(path, JSON.stringify(models));
    assert.equal((await loadConfig(path)).sandbox.enabled, true);
    for (const extra of [
      { budgets: { fastWorkerAttempts: 0 } },
      { budgets: { workerVerificationRetries: -1 } },
      { budgets: { fastWorkerAttempts: "unlimited" } },
      { sandbox: { enabled: "false" } },
      { verification: { finalCommands: "npm test" } },
      { worker: { provider: "", model: "worker" } },
    ]) {
      await writeFile(path, JSON.stringify({ ...models, ...extra }));
      await assert.rejects(loadConfig(path));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
