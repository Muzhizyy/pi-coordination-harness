import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { PiRuntime, roleMetrics } from "../pi/session.js";
import { terminalExtension } from "../pi/terminal.js";
import { loadPrompt, render } from "../prompts.js";
import type { ProjectIrSnapshot } from "../project/project-ir.js";
import { projectArchitecture, contextUnits } from "../project/architecture.js";
import { createEvidenceScout, EvidenceResolver, PlannerContextBudget } from "../project/evidence.js";
import type { EvidencePacket, EvidenceRequest, HarnessConfig, PlanDelta, PlannerDeferral, PlannerEvent, ProjectPlan, RunMetrics } from "../types.js";
import { addRoleMetrics } from "../runtime/metrics.js";
import { createCommitPlanDeltaTool, createCommitPlanTool } from "./tools.js";
import { createArchitectureTools } from "./architecture-tools.js";

export interface PlannerArtifacts {
  evidence?: (request: EvidenceRequest, packet: EvidencePacket) => Promise<void>;
  view?: (reason: string, view: unknown) => Promise<void>;
  deferral?: (value: PlannerDeferral, sequence: number) => Promise<void>;
}

/** Each decision session is bounded. Missing evidence terminates it and resumes a fresh one. */
export class PlannerRuntime {
  constructor(private readonly repo: string, private readonly config: HarnessConfig, private readonly pi: PiRuntime,
    private readonly metrics: RunMetrics, private readonly artifacts: PlannerArtifacts = {}) {}
  private resolver(ir: ProjectIrSnapshot, budget: PlannerContextBudget): EvidenceResolver {
    return new EvidenceResolver(this.repo, ir.index, budget, createEvidenceScout(this.repo, this.config.scout ?? this.config.worker, this.pi, this.metrics, this.config.sandbox), this.config.sandbox.denyRead, this.artifacts.evidence);
  }
  private charge(budget: PlannerContextBudget): void {
    this.metrics.plannerContext.architectureUnits += budget.architectureUnits;
    this.metrics.plannerContext.rawCodeUnits += budget.rawCodeUnits;
    this.metrics.plannerContext.evidenceRequests += budget.evidenceRequests;
  }
  private async decide<T>(requirement: string, ir: ProjectIrSnapshot, reason: string,
    makeTool: (capture: (value: T) => void) => ReturnType<typeof createCommitPlanTool> | ReturnType<typeof createCommitPlanDeltaTool>,
    template: string, extra: Record<string, string> = {}, currentPlan?: ProjectPlan): Promise<T> {
    let prepared: EvidencePacket[] = [];
    for (let turn = 0; turn <= (this.config.budgets.plannerDeferrals ?? 2); turn++) {
      const budget = new PlannerContextBudget(this.config.plannerContext);
      budget.semantic({ requirement, extra, prepared });
      const remaining = budget.limits.architectureTokens - budget.architectureUnits;
      const critical = currentPlan?.tasks.flatMap((t) => t.knowledgeRefs.map((r) => r.id)) ?? [];
      const view = projectArchitecture(ir.index, `${requirement} ${extra.TRIGGER ?? ""}`, Math.max(1024, Math.floor(remaining * (prepared.length ? 0.35 : 0.5))), critical);
      budget.semantic(view);
      await this.artifacts.view?.(reason, view);
      const resolver = this.resolver(ir, budget);
      let captured: T | undefined;
      let deferred: PlannerDeferral | undefined;
      const isTerminal = () => captured !== undefined || deferred !== undefined;
      const terminal = makeTool((value) => { if (isTerminal()) throw new Error("Decision already committed"); captured = value; });
      const defer = defineTool({
        name: "defer_decision", label: "Defer decision", description: "Finish without a plan when critical evidence is missing or context is exhausted. A fresh bounded decision session follows scoped evidence retrieval.",
        parameters: Type.Object({ reason: Type.String({ minLength: 1, maxLength: 600 }), requests: Type.Array(Type.Object({ question: Type.String(), decision: Type.String(), scope: Type.Object({ modules: Type.Array(Type.String()), symbols: Type.Array(Type.String()), files: Type.Array(Type.String()) }), types: Type.Array(Type.Union([Type.Literal("interfaces"), Type.Literal("dependencies"), Type.Literal("callers"), Type.Literal("tests"), Type.Literal("behavior")]), { minItems: 1 }) }), { minItems: 1, maxItems: 3 }) }),
        execute: async (_id, params) => { if (isTerminal()) throw new Error("Decision already committed"); deferred = { status: "needs_evidence", ...params }; return { content: [{ type: "text", text: "Decision deferred; stop." }], details: {} }; },
      });
      const tools = [...createArchitectureTools(ir.index, budget, resolver), terminal, defer];
      if (currentPlan) tools.push(defineTool({ name: "inspect_task", label: "Inspect task", description: "Retrieve the full current contract spec for a task id.", parameters: Type.Object({ id: Type.String() }), execute: async (_call, { id }) => { const task = currentPlan.tasks.find((t) => t.id === id); budget.semantic(task ?? { missing: id }); return { content: [{ type: "text", text: JSON.stringify(task ?? { missing: id }) }], details: {} }; } }));
      this.metrics.plannerWakeups.push({ reason: turn ? `DEFERRED_${reason}` : reason, at: new Date().toISOString() });
      const session = await this.pi.createRoleSession({ cwd: this.repo, profile: this.config.planner, systemPrompt: await loadPrompt("planner-system.md"), tools: tools.map((t) => t.name), customTools: tools,
        extensionFactories: [terminalExtension(terminal.name, isTerminal), terminalExtension(defer.name, isTerminal)] });
      try {
        await session.prompt(render(await loadPrompt(template), { REQUIREMENT: requirement, ARCHITECTURE_VIEW: JSON.stringify(view), ...extra }) + `\nPREPARED_EVIDENCE: ${JSON.stringify(prepared)}\nFacts carry validation/status. Candidate or dirty claims are hypotheses. Use defer_decision if a missing fact changes the contract; do not force a decision.`);
        if (captured !== undefined) return captured;
        if (!deferred) throw new Error(`Planner did not commit or defer the decision`);
      } finally { addRoleMetrics(this.metrics.planner, roleMetrics(session)); this.charge(budget); session.dispose(); }
      await this.artifacts.deferral?.(deferred, turn + 1);
      if (turn === (this.config.budgets.plannerDeferrals ?? 2)) throw new Error("Planner evidence deferral limit reached; critical decision remains unresolved");
      const retrievalBudget = new PlannerContextBudget(this.config.plannerContext);
      try {
        const retrieval = this.resolver(ir, retrievalBudget);
        prepared = [];
        for (const request of deferred.requests) prepared.push(await retrieval.resolve(request));
      } finally { this.charge(retrievalBudget); }
    }
    throw new Error("Unreachable planner state");
  }
  plan(requirement: string, ir: ProjectIrSnapshot): Promise<ProjectPlan> { return this.decide(requirement, ir, "INITIAL_REQUIREMENT", createCommitPlanTool, "planner-initial.md"); }
  replan(input: { requirement: string; ir: ProjectIrSnapshot; currentPlan: ProjectPlan; event: PlannerEvent }): Promise<PlanDelta> {
    if (!["CONTRACT_CONFLICT", "ARCHITECTURE_ASSUMPTION_INVALIDATED", "TASK_GRAPH_BLOCKED"].includes(input.event.reason)) throw new Error("Invalid project-level Planner event");
    if (contextUnits(input.event) > 2000) throw new Error("Planner event must be a bounded semantic projection");
    return this.decide(input.requirement, input.ir, input.event.reason, createCommitPlanDeltaTool, "planner-replan.md", {
      CURRENT_PLAN: JSON.stringify({ summary: input.currentPlan.summary, requirements: input.currentPlan.requirements, tasks: input.currentPlan.tasks.map((t) => ({ id: t.id, goal: t.goal.slice(0, 160), dependencies: t.dependencies })), detailTool: "inspect_task" }), TRIGGER: JSON.stringify(input.event),
    }, input.currentPlan);
  }
}
