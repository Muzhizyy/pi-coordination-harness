import type { PlanDelta, PlanTaskSpec, ProjectPlan, TaskContract } from "../types.js";
import { validateCoverage, validateTaskObligations } from "../verifier/obligations.js";

export function applyPlanDelta(plan: ProjectPlan, delta: PlanDelta): ProjectPlan {
  const cancelled = new Set([...delta.cancelledTaskIds, ...delta.invalidatedTaskIds]);
  const revised = new Set(delta.revisedTasks.map((t) => t.id));
  const byId = new Map<string, PlanTaskSpec>();
  for (const task of plan.tasks) if (!cancelled.has(task.id) || revised.has(task.id)) byId.set(task.id, task);
  for (const task of delta.revisedTasks) byId.set(task.id, task);
  for (const task of delta.addedTasks) byId.set(task.id, task);
  return { ...plan, tasks: [...byId.values()] };
}

/** Validate a delta before changing live contracts or discarding worker state. */
export function validatePlanDelta(plan: ProjectPlan, delta: PlanDelta, accepted = new Set<string>()): void {
  const current = new Set(plan.tasks.map((t) => t.id));
  const revised = new Set(delta.revisedTasks.map((t) => t.id));
  const added = new Set(delta.addedTasks.map((t) => t.id));
  if (revised.size !== delta.revisedTasks.length || added.size !== delta.addedTasks.length) throw new Error("Duplicate task ids in plan delta");
  for (const id of revised) if (!current.has(id)) throw new Error(`Cannot revise unknown task: ${id}`);
  for (const id of added) if (current.has(id) || revised.has(id)) throw new Error(`Added task already exists: ${id}`);
  const changed = new Set([...revised, ...delta.cancelledTaskIds, ...delta.invalidatedTaskIds]);
  for (const id of changed) {
    if (!current.has(id)) throw new Error(`Unknown changed task: ${id}`);
    if (accepted.has(id)) throw new Error(`Cannot retroactively change accepted task: ${id}`);
  }
  for (const id of delta.cancelledTaskIds) if (revised.has(id)) throw new Error(`Cancelled task cannot also be revised: ${id}`);
  for (const id of delta.unaffectedTaskIds) if (!current.has(id) || changed.has(id)) throw new Error(`Invalid unaffected task: ${id}`);
  const next = applyPlanDelta(plan, delta);
  validatePlan(next);
  if (JSON.stringify(next.tasks) === JSON.stringify(plan.tasks)) throw new Error("Plan delta makes no progress");
}

export function makeContract(task: PlanTaskSpec, baseRevision: string, version = 1): TaskContract {
  return {
    id: task.id,
    version,
    goal: task.goal,
    baseRevision,
    writeScopes: task.writeScopes,
    constraints: task.constraints,
    acceptanceCriteria: task.acceptanceCriteria,
    verificationCommands: task.verificationCommands,
    dependencies: task.dependencies,
    contextHints: task.contextHints,
    escalateWhen: task.escalateWhen,
    obligations: task.obligations,
    knowledgeRefs: task.knowledgeRefs,
  };
}

export function readyTasks(plan: ProjectPlan, accepted: Set<string>, cancelled: Set<string>): PlanTaskSpec[] {
  return plan.tasks.filter((task) => !accepted.has(task.id) && !cancelled.has(task.id) && task.dependencies.every((d) => accepted.has(d)));
}

/** Reject unsafe artifact ids and unschedulable task graphs before creating worktrees. */
export function validatePlan(plan: ProjectPlan): void {
  const tasks = new Map<string, PlanTaskSpec>();
  if (plan.tasks.length === 0) throw new Error("Plan must contain at least one task");
  for (const task of plan.tasks) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(task.id)) throw new Error(`Invalid task id: ${task.id}`);
    if (tasks.has(task.id)) throw new Error(`Duplicate task id: ${task.id}`);
    tasks.set(task.id, task);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) throw new Error(`Dependency cycle at ${id}`);
    if (visited.has(id)) return;
    const task = tasks.get(id);
    if (!task) throw new Error(`Unknown task dependency: ${id}`);
    visiting.add(id);
    for (const dependency of task.dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of tasks.keys()) visit(id);
  for (const task of tasks.values()) validateTaskObligations(task);
  validateCoverage(plan);
}
