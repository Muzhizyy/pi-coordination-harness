import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { PiRuntime, roleMetrics } from "../pi/session.js";
import { loadPrompt, render } from "../prompts.js";
import { ProjectIrStore } from "../project/project-ir.js";
import { repositoryHead } from "../project/repository.js";
import { gitOk } from "../utils/exec.js";
import type { ModelProfile, PlanDelta, ProjectPlan, RunMetrics, WorkerOutcome } from "../types.js";
import { addRoleMetrics } from "../runtime/metrics.js";
import { createCommitPlanDeltaTool, createCommitPlanTool, createCommitProjectIrTool } from "./tools.js";

export class PlannerRuntime {
  constructor(
    private readonly repo: string,
    private readonly profile: ModelProfile,
    private readonly pi: PiRuntime,
    private readonly metrics: RunMetrics,
  ) {}

  private record(session: AgentSession, reason: string): void {
    addRoleMetrics(this.metrics.planner, roleMetrics(session));
    this.metrics.plannerWakeups.push({ reason, at: new Date().toISOString() });
  }

  async ensureProjectIr(): Promise<void> {
    const store = new ProjectIrStore(this.repo);
    const currentRevision = await repositoryHead(this.repo);
    const exists = await store.exists();
    if (exists) {
      const manifest = await store.manifest();
      if (manifest.indexedRevision === currentRevision) return;
      await this.refreshProjectIr(store, manifest.indexedRevision, currentRevision);
      return;
    }
    await this.bootstrapProjectIr(store);
  }

  private async bootstrapProjectIr(store: ProjectIrStore): Promise<void> {
    const inventory = await store.buildInventory();
    const systemPrompt = await loadPrompt("project-bootstrap-system.md");
    const userTemplate = await loadPrompt("project-bootstrap-request.md");
    let committed: Parameters<typeof store.saveSemantic>[0] | undefined;
    const commitTool = createCommitProjectIrTool((value) => {
      committed = { revision: inventory.revision, ...value };
    });
    const session = await this.pi.createRoleSession({
      cwd: this.repo,
      profile: this.profile,
      systemPrompt,
      tools: ["read", "grep", "find", "ls", "commit_project_ir"],
      customTools: [commitTool],
    });
    try {
      await session.prompt(render(userTemplate, {
        INVENTORY: JSON.stringify(inventory, null, 2),
      }));
      if (!committed) throw new Error(`Planner did not call commit_project_ir. Last response: ${session.getLastAssistantText() ?? "<none>"}`);
      await store.saveSemantic(committed);
      this.record(session, "PROJECT_IR_BOOTSTRAP");
    } finally {
      session.dispose();
    }
  }

  private async refreshProjectIr(store: ProjectIrStore, previousRevision: string, currentRevision: string): Promise<void> {
    const previous = await store.load();
    const inventory = await store.buildInventory();
    let changedFiles: string[];
    try {
      const changed = await gitOk(this.repo, ["diff", "--name-only", `${previousRevision}..${currentRevision}`]);
      changedFiles = changed ? changed.split("\n").filter(Boolean) : [];
    } catch {
      changedFiles = inventory.files;
    }
    const systemPrompt = await loadPrompt("project-bootstrap-system.md");
    const userTemplate = await loadPrompt("project-refresh-request.md");
    let committed: Parameters<typeof store.saveSemantic>[0] | undefined;
    const commitTool = createCommitProjectIrTool((value) => {
      committed = { revision: currentRevision, ...value };
    });
    const session = await this.pi.createRoleSession({
      cwd: this.repo,
      profile: this.profile,
      systemPrompt,
      tools: ["read", "grep", "find", "ls", "commit_project_ir"],
      customTools: [commitTool],
    });
    try {
      await session.prompt(render(userTemplate, {
        ARCHITECTURE: previous.architecture,
        PROJECT_INDEX: JSON.stringify(previous.index, null, 2),
        DECISIONS: previous.decisions,
        PREVIOUS_REVISION: previousRevision,
        CURRENT_REVISION: currentRevision,
        CHANGED_FILES: changedFiles.join("\n") || "<none>",
        INVENTORY: JSON.stringify(inventory, null, 2),
      }));
      if (!committed) throw new Error(`Planner did not refresh Project IR. Last response: ${session.getLastAssistantText() ?? "<none>"}`);
      await store.saveSemantic(committed);
      this.record(session, "PROJECT_IR_REFRESH");
    } finally {
      session.dispose();
    }
  }

  async plan(requirement: string): Promise<ProjectPlan> {
    await this.ensureProjectIr();
    const store = new ProjectIrStore(this.repo);
    const ir = await store.load();
    const systemPrompt = await loadPrompt("planner-system.md");
    const template = await loadPrompt("planner-initial.md");
    let plan: ProjectPlan | undefined;
    const tool = createCommitPlanTool((value) => { plan = value; });
    const session = await this.pi.createRoleSession({
      cwd: this.repo,
      profile: this.profile,
      systemPrompt,
      tools: ["read", "grep", "find", "ls", "commit_plan"],
      customTools: [tool],
    });
    try {
      await session.prompt(render(template, {
        REQUIREMENT: requirement,
        ARCHITECTURE: ir.architecture,
        PROJECT_INDEX: JSON.stringify(ir.index, null, 2),
        DECISIONS: ir.decisions,
      }));
      if (!plan) throw new Error(`Planner did not call commit_plan. Last response: ${session.getLastAssistantText() ?? "<none>"}`);
      this.record(session, "INITIAL_PLAN");
      return plan;
    } finally { session.dispose(); }
  }

  async replan(input: {
    requirement: string;
    currentPlan: ProjectPlan;
    taskOutcome: WorkerOutcome;
    evidence: string;
  }): Promise<PlanDelta> {
    const ir = await new ProjectIrStore(this.repo).load();
    const systemPrompt = await loadPrompt("planner-system.md");
    const template = await loadPrompt("planner-replan.md");
    let delta: PlanDelta | undefined;
    const tool = createCommitPlanDeltaTool((value) => { delta = value; });
    const session = await this.pi.createRoleSession({
      cwd: this.repo,
      profile: this.profile,
      systemPrompt,
      tools: ["read", "grep", "find", "ls", "commit_plan_delta"],
      customTools: [tool],
    });
    try {
      await session.prompt(render(template, {
        REQUIREMENT: input.requirement,
        ARCHITECTURE: ir.architecture,
        PROJECT_INDEX: JSON.stringify(ir.index, null, 2),
        CURRENT_PLAN: JSON.stringify(input.currentPlan, null, 2),
        TRIGGER: JSON.stringify(input.taskOutcome, null, 2),
        EVIDENCE: input.evidence,
      }));
      if (!delta) throw new Error(`Planner did not call commit_plan_delta. Last response: ${session.getLastAssistantText() ?? "<none>"}`);
      this.record(session, "REPLAN_CONTRACT_CONFLICT");
      return delta;
    } finally { session.dispose(); }
  }
}
