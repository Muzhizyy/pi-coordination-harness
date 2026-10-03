import test from "node:test";
import assert from "node:assert/strict";
import { WorkerTaskLoop } from "../src/worker/task-loop.js";
import { WorkerTaskSession } from "../src/worker/worker-runtime.js";
import { makeContract, validatePlanDelta } from "../src/runtime/plan.js";
import { config, model, fakePi, obligation, planFields } from "./support.ts";
import { emptyRunMetrics } from "../src/runtime/metrics.js";
import type { PiRuntime } from "../src/pi/session.js";
import type { ProjectPlan, WorkerOutcome } from "../src/types.js";

const task = { id: "T1", goal: "Update", writeScopes: ["src/**"], constraints: [], acceptanceCriteria: [], verificationCommands: [], dependencies: [], contextHints: { files: [], symbols: [], tests: [], capabilities: [] }, escalateWhen: [], obligations: [obligation("T1.check")], knowledgeRefs: [] };
const contract = makeContract(task, "a".repeat(40));
const outcome = (status: WorkerOutcome["status"], extra: Partial<WorkerOutcome> = {}): WorkerOutcome => ({ status, taskId: "T1", contractVersion: 1, summary: "result", changedFiles: [], checksRun: [], evidence: [], residualRisks: [], ...extra });
const verified = { ok: true, changedFiles: ["src/main.ts"], commands: [], failures: [] };

function rig(outcomes: WorkerOutcome[], failures = 0, strong = false) {
  const workers: any[] = [];
  let verifies = 0;
  let contexts = 0;
  let attempts = 0;
  const loop = new WorkerTaskLoop({ ...config, ...(strong ? { strongWorker: model } : {}) }, (role) => {
    const worker = { role, starts: 0, retries: 0, disposals: 0,
      async start(c: any) { assert.deepEqual(c, contract); this.starts++; return outcomes.shift()!; },
      async retry(c: any) { assert.deepEqual(c, contract); this.retries++; return outcomes.shift()!; },
      async dispose() { this.disposals++; }, async execSandboxed() { return { exitCode: 0, output: "" }; },
    };
    workers.push(worker); return worker;
  }, async () => ++verifies <= failures ? { ...verified, ok: false, failures: ["TEST_FAILED"] } : verified, {
    diagnose: async (o) => ({ id: "D1", classification: o.status === "contract_conflict" ? "contract" : o.status === "environment_failure" ? "environment" : "implementation", summary: o.summary, observations: [] }),
    outcome: async () => {}, verification: async () => {}, context: async () => { contexts++; return "Extra local facts"; }, attempt: () => attempts++,
  });
  return { loop, workers, stats: () => ({ contexts, verifies, attempts }) };
}

test("ordinary verification failure and needs_context reuse the same Worker without a Planner dependency", async () => {
  const r = rig([outcome("needs_context"), outcome("candidate_ready"), outcome("candidate_ready")], 1);
  assert.equal((await r.loop.execute(contract, "local")).status, "verified");
  assert.equal(r.workers.length, 1);
  assert.equal(r.workers[0].retries, 2);
  assert.equal(r.workers[0].disposals, 1);
  assert.deepEqual(r.stats(), { contexts: 1, verifies: 2, attempts: 3 });
});

test("implementation exhaustion creates a strong Worker under the same contract", async () => {
  const r = rig([outcome("local_failure"), outcome("local_failure"), outcome("candidate_ready")], 0, true);
  assert.equal((await r.loop.execute(contract, "local")).status, "verified");
  assert.deepEqual(r.workers.map((w) => w.role), ["worker", "strongWorker"]);
  assert.ok(r.workers.every((w) => w.disposals === 1));
});

test("candidate_ready needs verification and exhausted verification does not loop forever", async () => {
  const r = rig([outcome("candidate_ready"), outcome("candidate_ready"), outcome("candidate_ready")], 10);
  await assert.rejects(r.loop.execute(contract, "local"), /local_failure/);
  assert.equal(r.stats().verifies, 3);
  assert.equal(r.workers[0].disposals, 1);
});

test("project conflict ends the Worker loop, while stale and environment outcomes fail closed", async () => {
  const r = rig([outcome("contract_conflict", { conflict: "Incompatible public interface" })]);
  const result = await r.loop.execute(contract, "local");
  assert.equal(result.status, "project_event");
  assert.equal(r.stats().verifies, 0);
  assert.equal(r.workers[0].disposals, 1);
  await assert.rejects(rig([outcome("candidate_ready", { contractVersion: 0 })]).loop.execute(contract, "local"), /active task contract/);
  await assert.rejects(rig([outcome("environment_failure")]).loop.execute(contract, "local"), /environment/);
});

test("a Worker session rejects contract v2 retries before consuming old debugging context", async () => {
  const pi = fakePi(async (opts) => {
    await opts.customTools.find((t: any) => t.name === "submit_outcome").execute("outcome", outcome("local_failure"));
  });
  const session = new WorkerTaskSession(process.cwd(), model, config, pi as unknown as PiRuntime, emptyRunMetrics(), "worker");
  try {
    await session.start(contract, "local");
    await assert.rejects(session.retry({ ...contract, version: 2 }, "feedback"), /invalidates Worker context/);
    assert.equal(pi.sessions[0].prompts.length, 1);
    await session.retry(contract, "same contract");
    assert.equal(pi.sessions[0].prompts.length, 2);
  } finally { await session.dispose(); }
});

test("plan deltas reject unknown tasks, collisions, retroactive changes and ineffective replans", () => {
  const plan: ProjectPlan = { ...planFields, summary: "x", assumptions: [], tasks: [task], finalVerificationCommands: [] };
  const delta = { reason: "change", revisedTasks: [{ ...task, goal: "Changed" }], addedTasks: [], cancelledTaskIds: [], invalidatedTaskIds: ["T1"], unaffectedTaskIds: [] };
  assert.doesNotThrow(() => validatePlanDelta(plan, delta));
  assert.throws(() => validatePlanDelta(plan, delta, new Set(["T1"])), /accepted/);
  assert.throws(() => validatePlanDelta(plan, { ...delta, revisedTasks: [{ ...task, id: "T2" }] }), /unknown task/);
  assert.throws(() => validatePlanDelta(plan, { ...delta, addedTasks: [task] }), /already exists/);
  assert.throws(() => validatePlanDelta(plan, { ...delta, invalidatedTaskIds: [], revisedTasks: [task] }), /no progress/);
  assert.throws(() => validatePlanDelta(plan, { ...delta, cancelledTaskIds: ["T1"] }), /also be revised/);
});
