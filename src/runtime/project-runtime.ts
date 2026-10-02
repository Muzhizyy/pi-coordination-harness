import { randomUUID } from "node:crypto";
import type { HarnessConfig, ProjectPlan, TaskContract, WorkerOutcome } from "../types.js";
import { PiRuntime } from "../pi/session.js";
import { PlannerRuntime } from "../planner/planner-runtime.js";
import { ProjectIrStore } from "../project/project-ir.js";
import { assertGitRepository, repositoryHead } from "../project/repository.js";
import { WorkerTaskSession } from "../worker/worker-runtime.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { Verifier } from "../verifier/verifier.js";
import { emptyRunMetrics } from "./metrics.js";
import { RunStore } from "./run-store.js";
import { applyPlanDelta, makeContract, readyTasks, validatePlan } from "./plan.js";
import { workerProjectContext } from "./context.js";
import { KnowledgeBuilder } from "../project/knowledge-builder.js";
import { assertActiveOutcome, projectEvent } from "./events.js";

export interface RunResult {
  runId: string;
  patchPath: string;
  acceptedTasks: string[];
  metricsPath: string;
}

export class ProjectRuntime {
  private readonly pi = new PiRuntime();
  private readonly metrics = emptyRunMetrics();

  constructor(private readonly repo: string, private readonly config: HarnessConfig) {}

  async run(requirement: string): Promise<RunResult> {
    await assertGitRepository(this.repo);
    const baseRevision = await repositoryHead(this.repo);
    const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const runStore = new RunStore(this.repo, runId);
    await runStore.init(requirement, baseRevision);
    let ir = await new KnowledgeBuilder(this.repo, this.config.scout ?? this.config.worker, this.pi, this.metrics, this.config.sandbox).ensure();
    let decisionSequence = 0;
    const plannerArtifacts = {
      evidence: runStore.writeEvidencePacket.bind(runStore),
      view: async (reason: string, view: unknown) => runStore.writeArchitectureView(reason, ++decisionSequence, view),
    };
    const planner = new PlannerRuntime(this.repo, this.config, this.pi, this.metrics, plannerArtifacts);
    let plan = await planner.plan(requirement, ir);
    validatePlan(plan);
    await runStore.writePlan(plan);
    await runStore.writeProjectSnapshot(ir);
    const workspace = new WorkspaceManager(this.repo, runId);
    const integration = await workspace.createIntegration(baseRevision);
    const verifier = new Verifier(this.config);
    const accepted = new Set<string>();
    const cancelled = new Set<string>();
    const contractVersions = new Map<string, number>();

    try {
      while (plan.tasks.some((task) => !accepted.has(task.id) && !cancelled.has(task.id))) {
        const ready = readyTasks(plan, accepted, cancelled);
        if (ready.length === 0) throw new Error("Task graph is blocked: no ready tasks and run is incomplete.");
        const task = ready[0];
        const taskPath = await workspace.createTask(task.id);
        const base = await workspace.integrationHead();
        const version = contractVersions.get(task.id) ?? 1;
        const contract: TaskContract = makeContract(task, base, version);
        await runStore.writeTask(contract);
        const context = workerProjectContext(ir, contract);
        let outcome: WorkerOutcome | undefined;
        let session = new WorkerTaskSession(taskPath, this.config.worker, this.config, this.pi, this.metrics, "worker");
        let verificationRetries = 0;
        let attempts = 0;
        let escalated = false;
        try {
          outcome = await session.start(contract, context);
          attempts++;
          this.metrics.taskAttempts[task.id] = (this.metrics.taskAttempts[task.id] ?? 0) + 1;
          while (true) {
            assertActiveOutcome(outcome, contract);
            await runStore.writeOutcome(outcome, attempts);
            if (outcome.status === "candidate_ready") {
              const verification = await verifier.verifyTask(taskPath, contract, (command) => session.execSandboxed(command));
              await runStore.writeVerification(`${task.id}-${attempts}`, verification);
              if (verification.ok) {
                await workspace.acceptTask(taskPath, task.id);
                accepted.add(task.id);
                break;
              }
              if (verificationRetries >= this.config.budgets.workerVerificationRetries) {
                outcome = { ...outcome, status: "local_failure", summary: "Deterministic verification retry budget exhausted", evidence: [...outcome.evidence, ...verification.failures] };
                continue;
              }
              verificationRetries++;
              outcome = await session.retry(contract, verification.failures.join("\n\n"));
              attempts++;
              this.metrics.taskAttempts[task.id]++;
              continue;
            }
            if (outcome.status === "needs_context") {
              if (attempts >= this.config.budgets.fastWorkerAttempts) {
                throw new Error(`Task ${task.id} exhausted its context retry budget`);
              }
              outcome = await session.retry(contract, `Requested context: ${outcome.requestedContext ?? "unspecified"}. Inspect the repository directly with read-only tools.`);
              attempts++;
              this.metrics.taskAttempts[task.id]++;
              continue;
            }
            if (outcome.status === "contract_conflict") {
              const event = projectEvent(outcome)!;
              await runStore.writePlannerEvent(event, decisionSequence + 1);
              const delta = await new PlannerRuntime(integration, this.config, this.pi, this.metrics, plannerArtifacts).replan({ requirement, ir, currentPlan: plan, event });
              const retroactive = [...delta.cancelledTaskIds, ...delta.invalidatedTaskIds, ...delta.revisedTasks.map((task) => task.id)].filter((id) => accepted.has(id));
              if (retroactive.length > 0) {
                throw new Error(`V1 cannot retroactively cancel/invalidate accepted tasks: ${retroactive.join(", ")}. Start a new run or add explicit rollback support.`);
              }
              if (this.metrics.plannerWakeups.filter((event) => event.reason === "CONTRACT_CONFLICT").length > 8) {
                throw new Error("Contract conflict replan limit exceeded (8)");
              }
              plan = applyPlanDelta(plan, delta);
              await runStore.writePlanDelta(delta, decisionSequence);
              validatePlan(plan);
              await runStore.writePlan(plan);
              for (const revised of delta.revisedTasks) {
                contractVersions.set(revised.id, (contractVersions.get(revised.id) ?? 1) + 1);
              }
              for (const id of delta.cancelledTaskIds) cancelled.add(id);
              break;
            }
            if ((outcome.status === "local_failure" || outcome.status === "budget_exhausted") && attempts < this.config.budgets.fastWorkerAttempts) {
              outcome = await session.retry(contract, `Local failure: ${outcome.summary}\nEvidence: ${outcome.evidence.join("\n")}`);
              attempts++;
              this.metrics.taskAttempts[task.id]++;
              continue;
            }
            if ((outcome.status === "local_failure" || outcome.status === "budget_exhausted") && this.config.strongWorker && !escalated) {
              escalated = true;
              verificationRetries = 0;
              await session.dispose();
              session = new WorkerTaskSession(taskPath, this.config.strongWorker, this.config, this.pi, this.metrics, "strongWorker");
              outcome = await session.start(contract, context + `\n\nPrevious fast-worker failure:\n${JSON.stringify(outcome, null, 2)}`);
              attempts++;
              this.metrics.taskAttempts[task.id]++;
              continue;
            }
            throw new Error(`Task ${task.id} failed with ${outcome.status}: ${outcome.summary}`);
          }
        } finally {
          await session.dispose();
          await workspace.removeTask(taskPath);
        }
      }

      const finalCommands = [...new Set([...plan.finalVerificationCommands, ...this.config.verification.finalCommands])];
      const finalVerification = await verifier.verifyFinal(integration, finalCommands);
      await runStore.writeVerification("final", finalVerification);
      if (!finalVerification.ok) throw new Error(finalVerification.failures.join("\n"));
      const patch = await workspace.finalPatch(baseRevision);
      await runStore.writeFinalPatch(patch);
      await runStore.writeMetrics(this.metrics);
      await runStore.finish("complete", { acceptedTasks: [...accepted], finalVerification });
      return {
        runId,
        patchPath: `${runStore.dir}/final.patch`,
        acceptedTasks: [...accepted],
        metricsPath: `${runStore.dir}/metrics.json`,
      };
    } catch (error) {
      await runStore.writeMetrics(this.metrics);
      await runStore.finish("failed", { error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      await workspace.dispose();
    }
  }
}
