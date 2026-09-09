import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceManager } from "../src/workspace/workspace-manager.js";
import { gitOk, git } from "../src/utils/exec.js";

test("exported patch applies exactly and original checkout is preserved", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-export-"));
  const manager = new WorkspaceManager(root, "test");
  try {
    await gitOk(root, ["init"]);
    await writeFile(join(root, "hello.txt"), "before\n");
    await gitOk(root, ["add", "."]);
    await gitOk(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base"]);
    const base = await gitOk(root, ["rev-parse", "HEAD"]);
    await manager.createIntegration(base);
    await assert.rejects(manager.createTask("../../escape"), /Invalid task id/);
    const worker = await manager.createTask("T1");
    await writeFile(join(worker, "hello.txt"), "after\n\n");
    await manager.acceptTask(worker, "T1");
    await manager.removeTask(worker);
    const patch = await manager.finalPatch(base);
    assert.ok(patch.endsWith("\n"));
    assert.equal(await readFile(join(root, "hello.txt"), "utf8"), "before\n");
    await writeFile(join(root, "result.patch"), patch);
    assert.equal((await git(root, ["apply", "--check", "result.patch"])).exitCode, 0);
    await gitOk(root, ["apply", "result.patch"]);
    assert.equal(await readFile(join(root, "hello.txt"), "utf8"), "after\n\n");
  } finally {
    await manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
