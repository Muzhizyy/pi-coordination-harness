import test from "node:test";
import assert from "node:assert/strict";
import { PlannerRuntime } from "../src/planner/planner-runtime.js";
import { terminalExtension } from "../src/pi/terminal.js";
import { emptyRunMetrics } from "../src/runtime/metrics.js";
import { projectEvent } from "../src/runtime/events.js";
import { config, fakePi, simpleIndex } from "./support.ts";
import type { PiRuntime } from "../src/pi/session.js";

const ir = { index: simpleIndex, architecture: "RAW_CODE_SENTINEL", decisions: "FULL_DECISIONS_SENTINEL" };

test("Planner has only architectural tools, projected context and a fresh terminal decision session", async () => {
  const pi = fakePi(async (opts, prompt) => {
    for (const name of ["read", "grep", "find", "ls", "bash", "edit", "write", "commit_project_ir"]) assert.ok(!opts.tools.includes(name));
    for (const name of ["inspect_architecture", "inspect_interface", "inspect_impact", "request_evidence", "commit_plan"]) assert.ok(opts.tools.includes(name));
    assert.ok(!prompt.includes("RAW_CODE_SENTINEL"));
    assert.ok(!prompt.includes("FULL_DECISIONS_SENTINEL"));
    const terminal = opts.customTools.find((t: any) => t.name === "commit_plan");
    await terminal.execute("call", { summary: "planned", assumptions: [], tasks: [], finalVerificationCommands: [] });
    await assert.rejects(terminal.execute("duplicate", {}), /already committed/);
  });
  const metrics = emptyRunMetrics();
  const planner = new PlannerRuntime(".", config, pi as unknown as PiRuntime, metrics);
  assert.equal((await planner.plan("Update API", ir)).summary, "planned");
  await planner.plan("Another requirement", ir);
  assert.equal(pi.sessions.length, 2);
  assert.ok(pi.sessions.every((s) => s.disposed));
  assert.deepEqual(metrics.plannerWakeups.map((e) => e.reason), ["INITIAL_REQUIREMENT", "INITIAL_REQUIREMENT"]);
});

test("local outcomes cannot become Planner events and conflict projection omits logs and diff", () => {
  const outcome: any = { taskId: "T1", contractVersion: 1, summary: "LOG_SENTINEL", evidence: ["DIFF_SENTINEL"], changedFiles: ["raw.ts"], checksRun: ["test logs"] };
  for (const status of ["local_failure", "candidate_ready", "needs_context", "environment_failure", "budget_exhausted", "blocked"]) assert.equal(projectEvent({ ...outcome, status }), undefined);
  const event = projectEvent({ ...outcome, status: "contract_conflict", conflict: "API preservation conflicts with requirement" });
  assert.equal(event?.reason, "CONTRACT_CONFLICT");
  assert.ok(!JSON.stringify(event).includes("SENTINEL"));
});

test("terminal extension aborts after commit and blocks subsequent or excess tool calls", async () => {
  const hooks: Record<string, any> = {};
  let committed = false;
  const extension: any = terminalExtension("commit_plan", () => committed, 1);
  extension.factory({ on: (name: string, hook: any) => { hooks[name] = hook; } });
  let aborts = 0;
  const ctx = { abort: () => aborts++ };
  assert.equal(await hooks.tool_call({}, ctx), undefined);
  assert.equal((await hooks.tool_call({}, ctx)).block, true);
  hooks.before_agent_start();
  committed = true;
  await hooks.tool_result({ toolName: "commit_plan", isError: false }, ctx);
  assert.equal((await hooks.tool_call({}, ctx)).block, true);
  assert.equal(aborts, 3);
});
