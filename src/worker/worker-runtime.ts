import { createBashTool, type AgentSession } from "@earendil-works/pi-coding-agent";
import { PiRuntime, roleMetrics } from "../pi/session.js";
import { loadPrompt, render } from "../prompts.js";
import { addRoleMetrics } from "../runtime/metrics.js";
import { createPathPolicyExtension } from "../sandbox/path-policy-extension.js";
import { SandboxController } from "../sandbox/sandbox-controller.js";
import type { HarnessConfig, ModelProfile, RunMetrics, TaskContract, WorkerOutcome } from "../types.js";
import { createSubmitOutcomeTool } from "./tools.js";

export class WorkerTaskSession {
  private session?: AgentSession;
  private captured?: WorkerOutcome;
  private sandbox = new SandboxController();

  constructor(
    private readonly workspace: string,
    private readonly profile: ModelProfile,
    private readonly config: HarnessConfig,
    private readonly pi: PiRuntime,
    private readonly metrics: RunMetrics,
    private readonly metricRole: "worker" | "strongWorker",
  ) {}

  async start(contract: TaskContract, projectContext: string): Promise<WorkerOutcome> {
    await this.sandbox.initialize(this.workspace, this.config.sandbox);
    const systemPrompt = await loadPrompt(this.metricRole === "strongWorker" ? "strong-worker-system.md" : "worker-system.md");
    const userTemplate = await loadPrompt("worker-task.md");
    const outcomeTool = createSubmitOutcomeTool((value) => { this.captured = value; });
    const sandboxedBash = createBashTool(this.workspace, { operations: this.sandbox.bashOperations() });
    this.session = await this.pi.createRoleSession({
      cwd: this.workspace,
      profile: this.profile,
      systemPrompt,
      tools: ["read", "grep", "find", "ls", "edit", "write", "bash", "submit_outcome"],
      customTools: [sandboxedBash, outcomeTool],
      extensionFactories: [createPathPolicyExtension(this.workspace, this.config.sandbox)],
      persistent: true,
    });
    await this.session.prompt(render(userTemplate, {
      TASK_CONTRACT: JSON.stringify(contract, null, 2),
      PROJECT_CONTEXT: projectContext,
    }));
    return this.consumeOutcome();
  }

  async execSandboxed(command: string): Promise<{ exitCode: number; output: string }> {
    return this.sandbox.exec(command, this.workspace);
  }

  async retry(contract: TaskContract, failureEvidence: string): Promise<WorkerOutcome> {
    if (!this.session) throw new Error("Worker session has not started");
    this.captured = undefined;
    const template = await loadPrompt("worker-retry.md");
    await this.session.prompt(render(template, {
      TASK_CONTRACT: JSON.stringify(contract, null, 2),
      FAILURE_EVIDENCE: failureEvidence,
    }));
    return this.consumeOutcome();
  }

  private consumeOutcome(): WorkerOutcome {
    if (!this.captured) {
      throw new Error(`Worker did not call submit_outcome. Last response: ${this.session?.getLastAssistantText() ?? "<none>"}`);
    }
    const out = this.captured;
    this.captured = undefined;
    return out;
  }

  async dispose(): Promise<void> {
    if (this.session) {
      addRoleMetrics(this.metrics[this.metricRole], roleMetrics(this.session));
      this.session.dispose();
      this.session = undefined;
    }
    await this.sandbox.dispose();
  }
}
