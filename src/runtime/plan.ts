import type { PlanDelta, PlanTaskSpec, ProjectPlan, TaskContract } from "../types.js";

export function applyPlanDelta(plan: ProjectPlan, delta: PlanDelta): ProjectPlan {
  const cancelled = new Set([...delta.cancelledTaskIds, ...delta.invalidatedTaskIds]);
  const byId = new Map<string, PlanTaskSpec>();
  for (const task of plan.tasks) if (!cancelled.has(task.id)) byId.set(task.id, task);
  for (const task of delta.revisedTasks) byId.set(task.id, task);
  for (const task of delta.addedTasks) byId.set(task.id, task);
  return { ...plan, tasks: [...byId.values()] };
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
}
