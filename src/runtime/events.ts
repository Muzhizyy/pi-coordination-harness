import type { PlannerEvent, WorkerOutcome } from "../types.js";

/** Only explicitly classified project conflicts cross the Planner boundary. */
export function projectEvent(outcome: WorkerOutcome): PlannerEvent | undefined {
  if (outcome.status !== "contract_conflict") return undefined;
  return {
    reason: "CONTRACT_CONFLICT", taskId: outcome.taskId, contractVersion: outcome.contractVersion,
    issue: (outcome.conflict?.trim() || "Task contract cannot be satisfied; request scoped evidence for the disputed assumptions.").slice(0, 600),
    evidenceIds: [],
  };
}

export function assertActiveOutcome(outcome: WorkerOutcome, contract: { id: string; version: number }): void {
  if (outcome.taskId !== contract.id || outcome.contractVersion !== contract.version) throw new Error("Worker outcome does not match the active task contract");
}
