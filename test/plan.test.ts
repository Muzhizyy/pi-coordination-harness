import test from "node:test";
import assert from "node:assert/strict";
import { applyPlanDelta, makeContract, readyTasks } from "../src/runtime/plan.ts";
import { obligation, planFields } from "./support.ts";
import type { ProjectPlan } from "../src/types.ts";

const task = (id: string, deps: string[] = []) => ({
  id, goal: id, writeScopes: ["src/**"], constraints: [], acceptanceCriteria: [], verificationCommands: [], dependencies: deps,
  contextHints: { files: [], symbols: [], tests: [], capabilities: [] }, escalateWhen: [], obligations: [obligation(`${id}.check`)], knowledgeRefs: [],
});

test("readyTasks honors dependencies", () => {
  const plan: ProjectPlan = { ...planFields, summary: "x", assumptions: [], tasks: [task("A"), task("B", ["A"])], finalVerificationCommands: [] };
  assert.deepEqual(readyTasks(plan, new Set(), new Set()).map((x) => x.id), ["A"]);
  assert.deepEqual(readyTasks(plan, new Set(["A"]), new Set()).map((x) => x.id), ["B"]);
});

test("plan delta preserves unaffected tasks", () => {
  const plan: ProjectPlan = { ...planFields, summary: "x", assumptions: [], tasks: [task("A"), task("B")], finalVerificationCommands: [] };
  const revisedB = { ...task("B"), goal: "B2" };
  const next = applyPlanDelta(plan, { reason: "r", revisedTasks: [revisedB], addedTasks: [task("C")], cancelledTaskIds: ["A"], invalidatedTaskIds: [], unaffectedTaskIds: [] });
  assert.deepEqual(next.tasks.map((x) => x.id), ["B", "C"]);
  assert.equal(next.tasks[0].goal, "B2");
  assert.equal(makeContract(next.tasks[0], "abc", 2).version, 2);
});

test("revised task replaces prior spec without dropping unrelated tasks", () => {
  const plan = {
    ...planFields,
    summary: "base",
    assumptions: [],
    finalVerificationCommands: [],
    tasks: [
      task("T1", []),
      task("T2", ["T1"]),
    ],
  };
  const revised = { ...task("T2", ["T1"]), goal: "revised goal" };
  const next = applyPlanDelta(plan, {
    reason: "contract conflict",
    revisedTasks: [revised],
    addedTasks: [],
    cancelledTaskIds: [],
    invalidatedTaskIds: ["T2"],
    unaffectedTaskIds: ["T1"],
  });
  assert.equal(next.tasks.length, 2);
  assert.equal(next.tasks.find((item) => item.id === "T2")?.goal, "revised goal");
});


test("plan validation rejects unsafe IDs, cycles, and missing dependencies", async () => {
  const { validatePlan } = await import("../src/runtime/plan.js");
  const plan = (tasks: ReturnType<typeof task>[]) => ({ ...planFields, summary: "x", assumptions: [], tasks, finalVerificationCommands: [] });
  assert.throws(() => validatePlan(plan([task("../../escape")])), /Invalid task id/);
  assert.throws(() => validatePlan(plan([task("A"), task("A")])), /Duplicate/);
  assert.throws(() => validatePlan(plan([task("A", ["B"]), task("B", ["A"])])), /cycle/);
  assert.throws(() => validatePlan(plan([task("A", ["missing"])])), /Unknown/);
  assert.doesNotThrow(() => validatePlan(plan([task("A"), task("B", ["A"])])));
});
