import { randomUUID } from "node:crypto";
import type { HarnessConfig, PlannerEvent, TaskContract } from "../types.js";
import { PiRuntime } from "../pi/session.js";
import { PlannerRuntime } from "../planner/planner-runtime.js";
import { KnowledgeBuilder } from "../project/knowledge-builder.js";
import { projectArchitecture } from "../project/architecture.js";
import { assertGitRepository, repositoryHead } from "../project/repository.js";
import { WorkerTaskSession } from "../worker/worker-runtime.js";
import { WorkerTaskLoop } from "../worker/task-loop.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { Verifier } from "../verifier/verifier.js";
import { emptyRunMetrics } from "./metrics.js";
import { RunStore } from "./run-store.js";
import { applyPlanDelta, makeContract, readyTasks, validatePlan, validatePlanDelta } from "./plan.js";
import { workerProjectContext } from "./context.js";

export interface RunResult {
  runId: string;
  patchPath: string;
  acceptedTasks: string[];
  metricsPath: string;
}

export class ProjectRuntime {
  constructor(private readonly repo: string, private readonly config: HarnessConfig, private readonly pi = new PiRuntime()) {}

  async run(requirement: string): Promise<RunResult> {
    await assertGitRepository(this.repo);
    const metrics = emptyRunMetrics();
    const baseRevision = await repositoryHead(this.repo);
    const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const runStore = new RunStore(this.repo, runId);
    await runStore.init(requirement, baseRevision);
    const workspace = new WorkspaceManager(this.repo, runId);
    let decisionSequence = 0;
    let replans = 0;
    const accepted = new Set<string>();
    const cancelled = new Set<string>();
    const versions = new Map<string, number>();
    const artifacts = {
      evidence: runStore.writeEvidencePacket.bind(runStore),
      view: async (reason: string, view: unknown) => runStore.writeArchitectureView(reason, ++decisionSequence, view),
    };
    const builder = (repo: string) => new KnowledgeBuilder(repo, this.config.scout ?? this.config.worker, this.pi, metrics, this.config.sandbox);

    try {
      let ir = await builder(this.repo).ensure();
      if (ir.index.revision !== baseRevision) throw new Error("Repository revision changed before initial planning; restart the run");
      let plan = await new PlannerRuntime(this.repo, this.config, this.pi, metrics, artifacts).plan(requirement, ir);
      validatePlan(plan);
      await runStore.writePlan(plan);
      await runStore.writeProjectSnapshot(ir);
      const integration = await workspace.createIntegration(baseRevision);
      const verifier = new Verifier(this.config);

      const replan = async (event: PlannerEvent): Promise<void> => {
        if (++replans > 8) throw new Error("Project replan limit exceeded (8)");
        await runStore.writePlannerEvent(event, replans);
        // The contested candidate has already been disposed and removed. Planner
        // evidence is anchored to accepted integration state, never unverified edits.
        const delta = await new PlannerRuntime(integration, this.config, this.pi, metrics, artifacts).replan({ requirement, ir, currentPlan: plan, event });
        validatePlanDelta(plan, delta, accepted);
        if (event.taskId && ![...delta.revisedTasks.map((t) => t.id), ...delta.cancelledTaskIds, ...delta.invalidatedTaskIds].includes(event.taskId)) {
          throw new Error("Replan must revise or retire the triggering task's invalid contract");
        }
        for (const task of delta.addedTasks) if (versions.has(task.id) || cancelled.has(task.id)) throw new Error(`Cannot reuse a retired task id: ${task.id}`);
        for (const task of delta.revisedTasks) versions.set(task.id, (versions.get(task.id) ?? 1) + 1);
        for (const id of [...delta.cancelledTaskIds, ...delta.invalidatedTaskIds]) if (!delta.revisedTasks.some((t) => t.id === id)) cancelled.add(id);
        plan = applyPlanDelta(plan, delta);
        await runStore.writePlanDelta(delta, replans);
        await runStore.writePlan(plan);
      };

      while (plan.tasks.some((task) => !accepted.has(task.id) && !cancelled.has(task.id))) {
        const task = readyTasks(plan, accepted, cancelled)[0];
        if (!task) {
          await replan({ reason: "TASK_GRAPH_BLOCKED", issue: "Task graph has unfinished tasks and no executable task", evidenceIds: [] });
          continue;
        }
        const taskPath = await workspace.createTask(task.id);
        let event: PlannerEvent | undefined;
        try {
          const version = versions.get(task.id) ?? 1;
          versions.set(task.id, version);
          const contract: TaskContract = makeContract(task, await workspace.integrationHead(), version);
          await runStore.writeTask(contract);
          const loop = new WorkerTaskLoop(this.config,
            (role) => new WorkerTaskSession(taskPath, role === "worker" ? this.config.worker : this.config.strongWorker!, this.config, this.pi, metrics, role),
            (worker) => verifier.verifyTask(taskPath, contract, (command) => worker.execSandboxed(command)), {
              outcome: runStore.writeOutcome.bind(runStore),
              verification: (result, attempt) => runStore.writeVerification(`${task.id}-v${version}-${attempt}`, result),
              context: async (question) => `Additional project context for: ${question}\n${JSON.stringify(projectArchitecture(ir.index, question, 6000))}\nInspect task-local source with read-only tools; keep the active contract.`,
              attempt: () => { metrics.taskAttempts[task.id] = (metrics.taskAttempts[task.id] ?? 0) + 1; },
            });
          const result = await loop.execute(contract, workerProjectContext(ir, contract));
          if (result.status === "verified") {
            await workspace.acceptTask(taskPath, task.id);
            accepted.add(task.id);
            // Semantic refresh is a fast-model knowledge operation, not a Planner wakeup.
            ir = await builder(integration).refresh(ir);
            await runStore.writeProjectSnapshot(ir);
          } else event = result.event;
        } finally { await workspace.removeTask(taskPath); }
        if (event) await replan(event);
      }

      const finalCommands = [...new Set([...plan.finalVerificationCommands, ...this.config.verification.finalCommands])];
      const finalVerification = await verifier.verifyFinal(integration, finalCommands);
      await runStore.writeVerification("final", finalVerification);
      if (!finalVerification.ok) throw new Error(finalVerification.failures.join("\n"));
      await runStore.writeFinalPatch(await workspace.finalPatch(baseRevision));
      await runStore.writeMetrics(metrics);
      await runStore.finish("complete", { acceptedTasks: [...accepted], finalVerification });
      return { runId, patchPath: `${runStore.dir}/final.patch`, acceptedTasks: [...accepted], metricsPath: `${runStore.dir}/metrics.json` };
    } catch (error) {
      await runStore.writeMetrics(metrics);
      await runStore.finish("failed", { acceptedTasks: [...accepted], error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally { await workspace.dispose(); }
  }
}
