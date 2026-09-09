import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { WorkerOutcome } from "../types.js";

export function createSubmitOutcomeTool(capture: (outcome: WorkerOutcome) => void) {
  return defineTool({
    name: "submit_outcome",
    label: "Submit Worker Outcome",
    description: "End the current worker decision cycle with a structured outcome. candidate_ready is not final acceptance.",
    parameters: Type.Object({
      status: Type.Union([
        Type.Literal("candidate_ready"), Type.Literal("needs_context"), Type.Literal("local_failure"),
        Type.Literal("contract_conflict"), Type.Literal("environment_failure"), Type.Literal("budget_exhausted"), Type.Literal("blocked"),
      ]),
      taskId: Type.String(),
      contractVersion: Type.Number(),
      summary: Type.String(),
      changedFiles: Type.Array(Type.String()),
      checksRun: Type.Array(Type.String()),
      evidence: Type.Array(Type.String()),
      requestedContext: Type.Optional(Type.String()),
      conflict: Type.Optional(Type.String()),
      residualRisks: Type.Array(Type.String()),
    }),
    execute: async (_id, params) => {
      capture(params);
      return { content: [{ type: "text", text: `Outcome ${params.status} recorded. Stop this turn.` }], details: {} };
    },
  });
}
