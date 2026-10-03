import type { DiagnosticReport, PlannerEvent, WorkerOutcome } from "../types.js";

/** Worker status is never sufficient. Only assessed diagnoses cross this boundary. */
export function projectEvent(outcome: WorkerOutcome, diagnosis?: DiagnosticReport): PlannerEvent | undefined {
  if (diagnosis?.classification !== "contract") return undefined;
  return {
    reason: diagnosis.observations.some((o) => o.obligationId.startsWith("knowledge:")) ? "ARCHITECTURE_ASSUMPTION_INVALIDATED" : "CONTRACT_CONFLICT",
    taskId: outcome.taskId, contractVersion: outcome.contractVersion,
    issue: diagnosis.summary.slice(0, 600), evidenceIds: [diagnosis.id],
  };
}

export function assertActiveOutcome(outcome: WorkerOutcome, contract: { id: string; version: number }): void {
  if (outcome.taskId !== contract.id || outcome.contractVersion !== contract.version) throw new Error("Worker outcome does not match the active task contract");
}
