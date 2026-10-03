import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { PlanDelta, ProjectIrIndex, ProjectPlan } from "../types.js";
import { ObligationSchema, DecisionSchema } from "./protocol-schema.js";

const ContextHintsSchema = Type.Object({
  files: Type.Array(Type.String()),
  symbols: Type.Array(Type.String()),
  tests: Type.Array(Type.String()),
  capabilities: Type.Array(Type.String()),
});

export const TaskSchema = Type.Object({
  id: Type.String(),
  goal: Type.String(),
  writeScopes: Type.Array(Type.String()),
  constraints: Type.Array(Type.String()),
  acceptanceCriteria: Type.Array(Type.String()),
  verificationCommands: Type.Array(Type.String()),
  dependencies: Type.Array(Type.String()),
  contextHints: ContextHintsSchema,
  escalateWhen: Type.Array(Type.String()),
  obligations: Type.Array(ObligationSchema, { minItems: 1 }),
  knowledgeRefs: Type.Array(Type.Object({ id: Type.String(), digest: Type.String() })),
});

export function createCommitProjectIrTool(capture: (value: {
  architectureMarkdown: string;
  modules: ProjectIrIndex["modules"];
  interfaces: ProjectIrIndex["interfaces"];
  capabilities: ProjectIrIndex["capabilities"];
  constraints: ProjectIrIndex["constraints"];
  unresolved: string[];
  dependencies?: ProjectIrIndex["dependencies"];
  decisions?: ProjectIrIndex["decisions"];
  removedKnowledgeIds?: string[];
}) => void) {
  return defineTool({
    name: "commit_project_ir",
    label: "Commit Project IR",
    description: "Commit the evidence-backed durable project architecture model after targeted repository inspection.",
    parameters: Type.Object({
      architectureMarkdown: Type.String(),
      modules: Type.Array(Type.Object({
        id: Type.String(), path: Type.String(), responsibility: Type.String(),
        evidence: Type.Array(Type.String()), confidence: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
        nonResponsibilities: Type.Array(Type.String()), publicInterfaces: Type.Array(Type.String()), tests: Type.Array(Type.String()),
      })),
      interfaces: Type.Array(Type.Object({
        id: Type.String(), name: Type.String(), kind: Type.String(), location: Type.String(), summary: Type.String(), evidence: Type.Array(Type.String()),
        owner: Type.String(), stability: Type.Union([Type.Literal("public"), Type.Literal("internal")]),
      })),
      capabilities: Type.Array(Type.Object({
        id: Type.String(), name: Type.String(), summary: Type.String(), entrypoints: Type.Array(Type.String()), examples: Type.Array(Type.String()), evidence: Type.Array(Type.String()),
      })),
      constraints: Type.Array(Type.Object({ id: Type.String(), summary: Type.String(), evidence: Type.Array(Type.String()) })),
      unresolved: Type.Array(Type.String()),
      dependencies: Type.Array(Type.Object({ from: Type.String(), to: Type.String(), kind: Type.Literal("semantic"), evidence: Type.Array(Type.String()) })),
      removedKnowledgeIds: Type.Optional(Type.Array(Type.String())),
    }),
    execute: async (_id, params) => {
      capture(params);
      return { content: [{ type: "text", text: "Project IR committed. Finish this planning turn." }], details: {} };
    },
  });
}

export function createCommitPlanTool(capture: (value: ProjectPlan) => void) {
  return defineTool({
    name: "commit_plan",
    label: "Commit Plan",
    description: "Commit the project-level task graph. Call exactly once when the plan is ready.",
    parameters: Type.Object({
      summary: Type.String(),
      assumptions: Type.Array(Type.String()),
      tasks: Type.Array(TaskSchema),
      finalVerificationCommands: Type.Array(Type.String()),
      requirements: Type.Array(Type.Object({ id: Type.String(), description: Type.String(), mandatory: Type.Boolean() }), { minItems: 1 }),
      projectObligations: Type.Array(ObligationSchema, { minItems: 1 }),
      decisions: Type.Array(DecisionSchema),
    }),
    execute: async (_id, params) => {
      capture(params);
      return { content: [{ type: "text", text: "Plan committed. Stop; workers will execute it." }], details: {} };
    },
  });
}

export function createCommitPlanDeltaTool(capture: (value: PlanDelta) => void) {
  return defineTool({
    name: "commit_plan_delta",
    label: "Commit Plan Delta",
    description: "Commit only the plan changes required by the triggering project-level event.",
    parameters: Type.Object({
      reason: Type.String(),
      revisedTasks: Type.Array(TaskSchema),
      addedTasks: Type.Array(TaskSchema),
      cancelledTaskIds: Type.Array(Type.String()),
      invalidatedTaskIds: Type.Array(Type.String()),
      unaffectedTaskIds: Type.Array(Type.String()),
      decisions: Type.Optional(Type.Array(DecisionSchema)),
    }),
    execute: async (_id, params) => {
      capture(params);
      return { content: [{ type: "text", text: "Plan delta committed. Stop this decision turn." }], details: {} };
    },
  });
}
