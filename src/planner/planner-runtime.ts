import { PiRuntime, roleMetrics } from "../pi/session.js";
import { terminalExtension } from "../pi/terminal.js";
import { loadPrompt, render } from "../prompts.js";
import type { ProjectIrSnapshot } from "../project/project-ir.js";
import { projectArchitecture, contextUnits } from "../project/architecture.js";
import { createEvidenceScout, EvidenceResolver, PlannerContextBudget } from "../project/evidence.js";
import type { EvidencePacket, EvidenceRequest, HarnessConfig, PlanDelta, PlannerEvent, ProjectPlan, RunMetrics } from "../types.js";
import { addRoleMetrics } from "../runtime/metrics.js";
import { createCommitPlanDeltaTool, createCommitPlanTool } from "./tools.js";
import { createArchitectureTools } from "./architecture-tools.js";

export interface PlannerArtifacts {
  evidence?: (request: EvidenceRequest, packet: EvidencePacket) => Promise<void>;
  view?: (reason: string, view: unknown) => Promise<void>;
}

/** Short-lived project decision loop, with no repository tool channel. */
export class PlannerRuntime {
  constructor(private readonly repo: string, private readonly config: HarnessConfig, private readonly pi: PiRuntime,
    private readonly metrics: RunMetrics, private readonly artifacts: PlannerArtifacts = {}) {}

  private async decide<T>(requirement: string, ir: ProjectIrSnapshot, reason: string,
    makeTool: (capture: (value: T) => void) => ReturnType<typeof createCommitPlanTool> | ReturnType<typeof createCommitPlanDeltaTool>,
    template: string, extra: Record<string, string> = {}): Promise<T> {
    const budget = new PlannerContextBudget(this.config.plannerContext);
    const view = projectArchitecture(ir.index, `${requirement} ${extra.TRIGGER ?? ""}`, Math.max(1024, Math.floor(budget.limits.architectureTokens * 0.6)));
    budget.semantic(view);
    await this.artifacts.view?.(reason, view);
    const resolver = new EvidenceResolver(this.repo, ir.index, budget,
      createEvidenceScout(this.repo, this.config.scout ?? this.config.worker, this.pi, this.metrics, this.config.sandbox),
      this.config.sandbox.denyRead, this.artifacts.evidence);
    let captured: T | undefined;
    const terminal = makeTool((value) => {
      if (captured !== undefined) throw new Error("Decision already committed");
      captured = value;
    });
    const tools = [...createArchitectureTools(ir.index, budget, resolver), terminal];
    this.metrics.plannerWakeups.push({ reason, at: new Date().toISOString() });
    const session = await this.pi.createRoleSession({
      cwd: this.repo, profile: this.config.planner, systemPrompt: await loadPrompt("planner-system.md"),
      tools: tools.map((t) => t.name), customTools: tools,
      extensionFactories: [terminalExtension(terminal.name, () => captured !== undefined)],
    });
    try {
      await session.prompt(render(await loadPrompt(template), {
        REQUIREMENT: requirement, ARCHITECTURE_VIEW: JSON.stringify(view), ...extra,
      }));
      if (captured === undefined) throw new Error(`Planner did not call ${terminal.name}`);
      return captured;
    } finally {
      addRoleMetrics(this.metrics.planner, roleMetrics(session));
      this.metrics.plannerContext.architectureUnits += budget.architectureUnits;
      this.metrics.plannerContext.rawCodeUnits += budget.rawCodeUnits;
      this.metrics.plannerContext.evidenceRequests += Math.min(budget.evidenceRequests, budget.limits.evidenceRequests);
      session.dispose();
    }
  }

  plan(requirement: string, ir: ProjectIrSnapshot): Promise<ProjectPlan> {
    return this.decide(requirement, ir, "INITIAL_REQUIREMENT", createCommitPlanTool, "planner-initial.md");
  }

  replan(input: { requirement: string; ir: ProjectIrSnapshot; currentPlan: ProjectPlan; event: PlannerEvent }): Promise<PlanDelta> {
    if (!["CONTRACT_CONFLICT", "ARCHITECTURE_ASSUMPTION_INVALIDATED", "TASK_GRAPH_BLOCKED"].includes(input.event.reason)) throw new Error("Invalid project-level Planner event");
    if (contextUnits(input.event) > 2000) throw new Error("Planner event must be a bounded semantic projection");
    return this.decide(input.requirement, input.ir, input.event.reason, createCommitPlanDeltaTool, "planner-replan.md", {
      CURRENT_PLAN: JSON.stringify(input.currentPlan), TRIGGER: JSON.stringify(input.event),
    });
  }
}
