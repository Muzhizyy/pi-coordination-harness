import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { KnowledgeBuilder } from "../src/project/knowledge-builder.js";
import { ProjectIrStore } from "../src/project/project-ir.js";
import { emptyRunMetrics } from "../src/runtime/metrics.js";
import { gitOk } from "../src/utils/exec.js";
import { config, simpleIndex, fakePi } from "./support.ts";
import type { PiRuntime } from "../src/pi/session.js";

test("Knowledge Builder uses a separate fast read-only role, reuses fresh IR and refreshes committed changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "knowledge-"));
  try {
    await gitOk(root, ["init"]);
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/main.ts"), "export const API = 1;\n");
    await gitOk(root, ["add", "."]);
    await gitOk(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base"]);
    await writeFile(join(root, "src/main.ts"), "DIRTY_SENTINEL\n");
    const metrics = emptyRunMetrics();
    const pi = fakePi(async (opts, prompt) => {
      assert.ok(!opts.tools.includes("bash"));
      assert.ok(!opts.tools.includes("edit"));
      assert.notEqual(opts.cwd, root);
      assert.ok(!(await readFile(join(opts.cwd, "src/main.ts"), "utf8")).includes("DIRTY_SENTINEL"));
      assert.ok(prompt.includes("src/main.ts"));
      await opts.customTools.find((t: any) => t.name === "commit_project_ir").execute("commit", {
        ...simpleIndex, architectureMarkdown: "Architecture facts",
      });
    });
    const builder = new KnowledgeBuilder(root, config.worker, pi as unknown as PiRuntime, metrics, config.sandbox);
    const initial = await builder.ensure();
    await builder.ensure();
    assert.equal(pi.sessions.length, 1);
    assert.equal(metrics.planner.calls, 0);
    assert.equal(metrics.knowledgeBuilder.calls, 1);
    await writeFile(join(root, "src/main.ts"), "export const API = 2;\n");
    await gitOk(root, ["add", "src/main.ts"]);
    await gitOk(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "change"]);
    const refreshed = await builder.ensure();
    assert.notEqual(initial.index.revision, refreshed.index.revision);
    assert.equal(pi.sessions.length, 2);
    assert.ok(pi.sessions[1].prompts[0].includes("Changed tracked files"));
    assert.equal((await new ProjectIrStore(root).manifest()).status, "fresh");
    assert.ok(pi.sessions.every((s) => s.disposed));
    assert.ok(!(await gitOk(root, ["worktree", "list", "--porcelain"])).includes("integration"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
