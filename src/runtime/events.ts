import type { PlannerEvent, WorkerOutcome } from "../types.js";

/** Only explicitly classified project conflicts cross the Planner boundary. */
export function projectEvent(outcome: WorkerOutcome): PlannerEvent | undefined {
  if (outcome.status !== "contract_conflict" && !(outcome.status === "blocked" && outcome.projectIssue)) return undefined;
  return {
    reason: outcome.status === "contract_conflict" ? "CONTRACT_CONFLICT" : outcome.projectIssue!.kind === "architecture_assumption_invalidated" ? "ARCHITECTURE_ASSUMPTION_INVALIDATED" : "TASK_GRAPH_BLOCKED",
    taskId: outcome.taskId, contractVersion: outcome.contractVersion,
    issue: (outcome.projectIssue?.summary.trim() || outcome.conflict?.trim() || "Task contract cannot be satisfied; request scoped evidence for the disputed assumptions.").slice(0, 600),
    evidenceIds: [`outcome:${outcome.taskId}:v${outcome.contractVersion}`],
  };
}

export function assertActiveOutcome(outcome: WorkerOutcome, contract: { id: string; version: number }): void {
  if (outcome.taskId !== contract.id || outcome.contractVersion !== contract.version) throw new Error("Worker outcome does not match the active task contract");
}
