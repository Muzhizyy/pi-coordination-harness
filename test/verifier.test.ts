import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Verifier } from "../src/verifier/verifier.js";
import { gitOk } from "../src/utils/exec.js";
import type { HarnessConfig, TaskContract } from "../src/types.js";

test("verification includes staged and untracked edits after check commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-verify-"));
  try {
    await gitOk(root, ["init"]);
    await writeFile(join(root, "base.txt"), "base\n");
    await gitOk(root, ["add", "."]);
    await gitOk(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base"]);
    const contract = {
      id: "T1", version: 1, baseRevision: await gitOk(root, ["rev-parse", "HEAD"]),
      writeScopes: ["allowed.txt"], verificationCommands: ["synthetic-check"],
    } as TaskContract;
    await writeFile(join(root, "allowed.txt"), "new\n");
    const verifier = new Verifier({} as HarnessConfig);
    const first = await verifier.verifyTask(root, { ...contract, verificationCommands: [] }, async () => ({ exitCode: 0, output: "" }));
    assert.equal(first.ok, true, JSON.stringify(first.failures));
    await gitOk(root, ["add", "allowed.txt"]);
    const staged = await verifier.verifyTask(root, { ...contract, verificationCommands: [] }, async () => ({ exitCode: 0, output: "" }));
    assert.equal(staged.ok, true);
    const final = await verifier.verifyTask(root, contract, async (command) => {
      if (command === "synthetic-check") await writeFile(join(root, "outside.txt"), "generated\n");
      return { exitCode: 0, output: "" };
    });
    assert.equal(final.ok, false);
    assert.ok(final.failures.includes("Write-scope violation: outside.txt"));
    assert.deepEqual(final.changedFiles.sort(), ["allowed.txt", "outside.txt"]);
    await gitOk(root, ["add", "outside.txt"]);
    const stagedOutside = await verifier.verifyTask(root, { ...contract, verificationCommands: [] }, async () => ({ exitCode: 0, output: "" }));
    assert.equal(stagedOutside.ok, false);
    assert.ok(stagedOutside.failures.includes("Write-scope violation: outside.txt"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
