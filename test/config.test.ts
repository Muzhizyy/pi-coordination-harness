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
    const pro = { provider: "example", model: "pro" };
    const flash = { provider: "example", model: "flash" };
    await writeFile(path, JSON.stringify({ pro, flash, proWorker: pro }));
    const configured = await loadConfig(path);
    assert.deepEqual(configured.planner, pro);
    assert.deepEqual(configured.worker, flash);
    assert.deepEqual(configured.strongWorker, pro);
    for (const extra of [
      { budgets: { fastWorkerAttempts: 0 } },
      { budgets: { workerVerificationRetries: -1 } },
      { budgets: { fastWorkerAttempts: "unlimited" } },
      { sandbox: { enabled: "false" } },
      { verification: { finalCommands: "npm test" } },
      { worker: { provider: "", model: "worker" } },
      { scout: { provider: "", model: "scout" } },
      { plannerContext: { architectureTokens: 100 } },
      { plannerContext: { rawCodeTokens: -1 } },
      { plannerContext: { evidenceRequests: "six" } },
    ]) {
      await writeFile(path, JSON.stringify({ ...models, ...extra }));
      await assert.rejects(loadConfig(path));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
