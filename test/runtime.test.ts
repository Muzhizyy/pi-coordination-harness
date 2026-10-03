import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectRuntime } from "../src/runtime/project-runtime.js";
import { gitOk, git } from "../src/utils/exec.js";
import { config, fakePi, simpleIndex, apiObligation, answerReview, planFields } from "./support.ts";
import type { PiRuntime } from "../src/pi/session.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "coordination-run-"));
  await gitOk(root, ["init"]);
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src/main.ts"), "export const API = 1;\n");
  await writeFile(join(root, ".gitignore"), ".agent-orch/\n");
  await gitOk(root, ["add", "."]);
  await gitOk(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base"]);
  return root;
}
const task = { id: "T1", goal: "Update API", writeScopes: ["src/**"], constraints: [], acceptanceCriteria: ["API = 2"], verificationCommands: [], dependencies: [], contextHints: { files: ["src/main.ts"], symbols: ["API"], tests: [], capabilities: [] }, escalateWhen: [], obligations: [apiObligation("T1.api")], knowledgeRefs: [] };

for (const conflict of [false, true]) test(`real Git run ${conflict ? "replans conflict with a fresh v2 Worker" : "accepts covered candidate without eager knowledge refresh"}`, async () => {
  const root = await fixture();
  let workers = 0;
  let knowledge = 0;
  const pi = fakePi(async (opts, prompt) => {
    if (await answerReview(opts, prompt)) return;
    const tool = (name: string) => opts.customTools.find((t: any) => t.name === name);
    if (tool("commit_project_ir")) {
      knowledge++;
      await tool("commit_project_ir").execute("ir", { ...simpleIndex, architectureMarkdown: "IR" });
    } else if (tool("commit_plan")) {
      await tool("commit_plan").execute("plan", { ...planFields, projectObligations: [{ ...apiObligation("project-api"), covers: [] }], summary: "Update", assumptions: [], tasks: [conflict ? { ...task, constraints: ["Preserve API = 1"], obligations: [...task.obligations, { ...apiObligation("T1.preserve", 1), description: "Preserve API = 1", covers: ["constraint:0"] }] } : task], finalVerificationCommands: [] });
    } else if (tool("commit_plan_delta")) {
      assert.ok(!prompt.includes("RAW_DEBUG_SENTINEL"));
      assert.ok(!prompt.includes("RAW_DIFF_SENTINEL"));
      assert.ok(!(await gitOk(root, ["worktree", "list", "--porcelain"])).includes("task-T1"));
      await tool("commit_plan_delta").execute("delta", { reason: "Correct contract", revisedTasks: [{ ...task, goal: "Clarified API update" }], addedTasks: [], cancelledTaskIds: [], invalidatedTaskIds: ["T1"], unaffectedTaskIds: [] });
    } else if (tool("submit_diagnosis")) {
      const input = JSON.parse(prompt);
      await tool("submit_diagnosis").execute("diagnose", { classification: "contract", summary: "Preserving API = 1 contradicts requested API = 2", observations: [{ obligationId: "T1.preserve", expected: "Preserve API = 1", observed: "Current API is 1 and task requires 2", evidence: [{ id: "base-api", kind: "source", locator: "src/main.ts:1", summary: "Current API = 1", revision: input.contract.baseRevision }] }] });
    } else if (tool("submit_outcome")) {
      workers++;
      if (conflict && workers === 1) {
        await writeFile(join(opts.cwd, "src/main.ts"), "UNVERIFIED_SENTINEL\n");
        await tool("submit_outcome").execute("conflict", { status: "contract_conflict", taskId: "T1", contractVersion: 1, summary: "RAW_DEBUG_SENTINEL", changedFiles: ["src/main.ts"], checksRun: [], evidence: ["RAW_DIFF_SENTINEL"], conflict: "Public interface constraint needs clarification", residualRisks: [] });
      } else {
        assert.equal(await readFile(join(opts.cwd, "src/main.ts"), "utf8"), "export const API = 1;\n");
        await writeFile(join(opts.cwd, "src/main.ts"), "export const API = 2;\n");
        await tool("submit_outcome").execute("candidate", { status: "candidate_ready", taskId: "T1", contractVersion: conflict ? 2 : 1, summary: "Ready", changedFiles: ["src/main.ts"], checksRun: [], evidence: [], residualRisks: [] });
      }
    } else throw new Error("Unexpected role");
  });
  try {
    const result = await new ProjectRuntime(root, config, pi as unknown as PiRuntime).run("Update API");
    const metrics = JSON.parse(await readFile(result.metricsPath, "utf8"));
    assert.deepEqual(metrics.plannerWakeups.map((w: any) => w.reason), conflict ? ["INITIAL_REQUIREMENT", "CONTRACT_CONFLICT"] : ["INITIAL_REQUIREMENT"]);
    assert.equal(knowledge, 1);
    assert.deepEqual(result.acceptedTasks, ["T1"]);
    assert.equal(await readFile(join(root, "src/main.ts"), "utf8"), "export const API = 1;\n");
    assert.equal((await git(root, ["apply", "--check", result.patchPath])).exitCode, 0);
    const dir = join(root, ".agent-orch/runs", result.runId);
    const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
    assert.equal(state.status, "complete");
    const snapshot = JSON.parse(await readFile(join(dir, "project-snapshot.json"), "utf8"));
    assert.notEqual(snapshot.index.revision, await gitOk(root, ["rev-parse", "HEAD"]));
    assert.equal(snapshot.index.repository.name, root.split("/").pop());
    if (conflict) {
      const files = await readdir(join(dir, "tasks"));
      assert.ok(files.includes("T1-v1.json") && files.includes("T1-v2.json"));
      assert.equal(pi.sessions.filter((s) => s.options.tools.includes("submit_outcome")).length, 2);
    }
    assert.ok(pi.sessions.every((s) => s.disposed));
    assert.ok(!(await gitOk(root, ["worktree", "list", "--porcelain"])).includes("integration"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
