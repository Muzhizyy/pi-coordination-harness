import { randomUUID } from "node:crypto";
import type { DecisionProposal, HarnessConfig, PlannerEvent, PlanTaskSpec, ProjectPlan, TaskContract, VerificationObligation } from "../types.js";
import { PiRuntime } from "../pi/session.js";
import { PlannerRuntime } from "../planner/planner-runtime.js";
import { KnowledgeBuilder } from "../project/knowledge-builder.js";
import { KnowledgeCoordinator } from "../project/knowledge-coordinator.js";
import { ProjectIrStore, type ProjectIrSnapshot } from "../project/project-ir.js";
import { bindTaskKnowledge, hash, invalidTaskRefs, proposeDecisions } from "../project/knowledge.js";
import { projectArchitecture } from "../project/architecture.js";
import { assertGitRepository, repositoryHead } from "../project/repository.js";
import { WorkerTaskSession } from "../worker/worker-runtime.js";
import { WorkerTaskLoop } from "../worker/task-loop.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { Verifier } from "../verifier/verifier.js";
import { SemanticReviewer } from "../verifier/semantic-reviewer.js";
import { candidateDigest } from "../verifier/source-snapshot.js";
import { gitOk } from "../utils/exec.js";
import { readJson } from "../utils/fs.js";
import { emptyRunMetrics } from "./metrics.js";
import { RunStore } from "./run-store.js";
import type { RunCheckpoint } from "./checkpoint.js";
import { Diagnoser } from "./diagnoser.js";
import { RepairCoordinator } from "./repair-coordinator.js";
import { applyPlanDelta, makeContract, readyTasks, validatePlan, validatePlanDelta } from "./plan.js";
import { workerProjectContext } from "./context.js";

export interface RunResult { runId: string; patchPath: string; acceptedTasks: string[]; metricsPath: string; checkpointRef: string }

export class ProjectRuntime {
  constructor(private readonly repo: string, private readonly config: HarnessConfig, private readonly pi = new PiRuntime()) {}
  async run(requirement: string): Promise<RunResult> {
    if (!requirement.trim()) throw new Error("Requirement cannot be empty");
    return this.execute(requirement);
  }
  async resume(runId: string): Promise<RunResult> {
    const runStore = new RunStore(this.repo, runId);
    const state = await readJson<{ status: string }>(`${runStore.dir}/state.json`);
    if (state.status === "complete") throw new Error("Run is already complete; use its verified patch");
    const checkpoint = await runStore.readCheckpoint();
    if (checkpoint.schemaVersion !== 1 || checkpoint.runId !== runId || checkpoint.configDigest !== hash(this.config)) throw new Error("Resume requires the original run id and configuration");
    return this.execute(checkpoint.requirement, checkpoint);
  }
  private async execute(requirement: string, previous?: RunCheckpoint): Promise<RunResult> {
    await assertGitRepository(this.repo);
    const baseRevision = previous?.baseRevision ?? await repositoryHead(this.repo);
    if (previous && await repositoryHead(this.repo) !== baseRevision) throw new Error("Original checkout HEAD changed; restore the run's base before resuming");
    const runId = previous?.runId ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const store = new RunStore(this.repo, runId);
    const workspace = new WorkspaceManager(this.repo, runId);
    const release = await store.acquire();
    const metrics = previous?.metrics ?? emptyRunMetrics();
    metrics.contractAttempts ??= {};
    const integrated = new Set(previous?.integratedTasks ?? []);
    const cancelled = new Set(previous?.cancelledTasks ?? []);
    const versions = new Map(previous?.versions ?? []);
    let sequence = previous?.sequence ?? 0, replans = previous?.replans ?? 0, repairAttempts = previous?.repairAttempts ?? 0;
    let ir: ProjectIrSnapshot;
    let plan: RunCheckpoint["plan"];
    const reviewer = new SemanticReviewer(this.config, this.pi, metrics);
    const knowledge = new KnowledgeCoordinator(this.repo, this.config, this.pi, metrics, reviewer);
    const diagnoser = new Diagnoser(this.config, this.pi, metrics);
    const verifier = new Verifier(this.config, reviewer);
    let integration = "";
    let checkpointReady = false;
    const checkpoint = async (): Promise<void> => {
      const revision = await workspace.checkpoint();
      await store.writeProjectSnapshot(ir);
      await store.writePlan(plan);
      await store.writeCheckpoint({ schemaVersion: 1, runId, requirement, baseRevision, integrationRevision: revision, configDigest: hash(this.config), plan, ir, integratedTasks: [...integrated], cancelledTasks: [...cancelled], versions: [...versions], repairAttempts, replans, sequence, metrics });
    };
    const artifacts = {
      evidence: async (request: Parameters<RunStore["writeEvidencePacket"]>[0], packet: Parameters<RunStore["writeEvidencePacket"]>[1]) => {
        await knowledge.promote(ir, integration, request, packet);
        await store.writeEvidencePacket(request, packet);
      },
      view: async (reason: string, view: unknown) => store.writeArchitectureView(reason, ++sequence, view),
      deferral: async (value: unknown) => store.writeArtifact(`planner-deferral-${++sequence}`, value),
    };
    const stageDecisions = async (decisions: DecisionProposal[], nextPlan: ProjectPlan): Promise<void> => {
      const ids = decisions.flatMap((d) => d.evidence.map((id) => ir.index.knowledge?.find((k) => k.id === id || k.evidence.some((e) => e.id === id))?.id).filter((id): id is string => id !== undefined));
      if (ids.length) ir = (await knowledge.demand(ir, integration, ids)).ir;
      proposeDecisions(ir.index, decisions, new Set(nextPlan.tasks.map((t) => t.id)), nextPlan.requirements);
    };
    try {
      if (previous) {
        const retained = await gitOk(this.repo, ["rev-parse", workspace.checkpointRef]);
        const ancestor = await gitOk(this.repo, ["merge-base", retained, previous.integrationRevision]);
        if (ancestor !== previous.integrationRevision) throw new Error("Checkpoint does not belong to the retained integration history");
        await store.markRunning();
      } else await store.init(requirement, baseRevision);
      integration = await workspace.createIntegration(previous?.integrationRevision ?? baseRevision);
      ir = previous?.ir ?? await new KnowledgeBuilder(this.repo, this.config.scout ?? this.config.worker, this.pi, metrics, this.config.sandbox).ensure();
      if (ir.index.revision !== await workspace.integrationHead()) throw new Error("Project knowledge does not match the integration checkpoint");
      if (previous) plan = previous.plan;
      else {
        const projected = projectArchitecture(ir.index, requirement, 6000);
        const dirty = projected.knowledge?.filter((k) => k.status === "dirty").map((k) => k.id) ?? [];
        if (dirty.length) ir = (await knowledge.demand(ir, integration, dirty)).ir;
        plan = await new PlannerRuntime(integration, this.config, this.pi, metrics, artifacts).plan(requirement, ir);
        validatePlan(plan);
        await stageDecisions(plan.decisions ?? [], plan);
        for (const task of plan.tasks) bindTaskKnowledge(task, ir.index);
      }
      checkpointReady = true;
      await checkpoint();

      const replan = async (event: PlannerEvent): Promise<void> => {
        if (++replans > 8) throw new Error("Project replan limit exceeded (8)");
        await store.writePlannerEvent(event, replans);
        const delta = await new PlannerRuntime(integration, this.config, this.pi, metrics, artifacts).replan({ requirement, ir, currentPlan: plan, event });
        validatePlanDelta(plan, delta, integrated);
        const changed = new Set([...delta.revisedTasks.map((t) => t.id), ...delta.cancelledTaskIds, ...delta.invalidatedTaskIds]);
        for (const id of [...(event.affectedTaskIds ?? []), ...(event.taskId ? [event.taskId] : [])]) if (!changed.has(id)) throw new Error(`Replan must revise or retire invalid contract ${id}`);
        for (const task of delta.addedTasks) if (versions.has(task.id) || cancelled.has(task.id)) throw new Error(`Cannot reuse retired task id: ${task.id}`);
        const nextPlan = applyPlanDelta(plan, delta);
        await stageDecisions(delta.decisions ?? [], nextPlan);
        for (const task of [...delta.revisedTasks, ...delta.addedTasks]) bindTaskKnowledge(task, ir.index);
        for (const task of delta.revisedTasks) versions.set(task.id, (versions.get(task.id) ?? 1) + 1);
        for (const id of [...delta.cancelledTaskIds, ...delta.invalidatedTaskIds]) if (!delta.revisedTasks.some((t) => t.id === id)) cancelled.add(id);
        plan = nextPlan;
        for (const d of ir.index.decisions ?? []) if (d.status === "proposed" && d.taskIds?.some((id) => cancelled.has(id))) d.status = "superseded";
        await store.writePlanDelta(delta, replans);
        await checkpoint();
      };

      const executeTask = async (task: PlanTaskSpec): Promise<PlannerEvent | undefined> => {
        const taskPath = await workspace.createTask(task.id);
        const version = versions.get(task.id) ?? 1;
        versions.set(task.id, version);
        const contract = makeContract(task, await workspace.integrationHead(), version);
        const attemptKey = `${task.id}@v${version}`;
        const attemptOffset = metrics.contractAttempts[attemptKey] ?? 0;
        await store.writeTask(contract);
        await store.writeArtifact(`task-state-${task.id}`, { state: "running", version, baseRevision: contract.baseRevision });
        try {
          const loop = new WorkerTaskLoop(this.config,
            (role) => new WorkerTaskSession(taskPath, role === "worker" ? this.config.worker : this.config.strongWorker!, this.config, this.pi, metrics, role),
            (worker) => verifier.verifyTask(taskPath, contract, (command) => worker.execSandboxed(command)), {
              outcome: (outcome, attempt) => store.writeOutcome(outcome, attemptOffset + attempt), verification: (result, attempt) => store.writeVerification(`${task.id}-v${version}-${attemptOffset + attempt}`, result),
              context: async (question) => `Additional verified project context for ${question}:\n${JSON.stringify(projectArchitecture(ir.index, question, 6000, contract.knowledgeRefs.map((r) => r.id)))}\nInspect local source under the SAME active contract.`,
              diagnose: async (outcome, verification) => { const report = await diagnoser.inspect(taskPath, contract, outcome, verification, ir.index); await store.writeArtifact(report.id, report); return report; },
              attempt: () => { metrics.taskAttempts[task.id] = (metrics.taskAttempts[task.id] ?? 0) + 1; metrics.contractAttempts[attemptKey] = (metrics.contractAttempts[attemptKey] ?? 0) + 1; },
            });
          const result = await loop.execute(contract, workerProjectContext(ir, contract));
          if (result.status === "project_event") {
            await store.writeArtifact(`task-state-${task.id}`, { state: "contract_invalid", version, evidenceIds: result.event.evidenceIds });
            return result.event;
          }
          if (result.verification.candidateDigest !== await candidateDigest(taskPath)) throw new Error("Candidate changed after verification; refusing integration");
          await store.writeArtifact(`task-state-${task.id}`, { state: "task_verified", version, verification: result.verification });
          const revision = await workspace.acceptTask(taskPath, task.id);
          await workspace.checkpoint(); // Keep committed progress reachable even if later metadata fails.
          integrated.add(task.id);
          await store.writeArtifact(`task-state-${task.id}`, { state: "integrated_pending", version, revision });
          const delta = await knowledge.advance(ir, integration, revision);
          await store.writeArtifact(`project-delta-${++sequence}`, delta);
          await checkpoint();
        } catch (error) {
          await store.writeArtifact(`task-state-${task.id}`, { state: "failed", version, error: String(error) });
          throw error;
        } finally { await workspace.removeTask(taskPath); }
      };

      while (true) {
        while (plan.tasks.some((t) => !integrated.has(t.id) && !cancelled.has(t.id))) {
          const task = readyTasks(plan, integrated, cancelled)[0];
          if (!task) { await replan({ reason: "TASK_GRAPH_BLOCKED", issue: "Unfinished graph has no executable task", evidenceIds: [] }); continue; }
          const demand = await knowledge.demand(ir, integration, task.knowledgeRefs.map((r) => r.id));
          ir = demand.ir;
          if (demand.changes.length) await store.writeArtifact(`knowledge-impact-${++sequence}`, demand.changes);
          const affected = plan.tasks.filter((t) => !integrated.has(t.id) && !cancelled.has(t.id) && (invalidTaskRefs(t, ir.index).length || demand.changes.some((c) => c.kind === "added" && c.id.startsWith("constraint:")))).map((t) => t.id);
          if (affected.length) {
            await replan({ reason: "ARCHITECTURE_ASSUMPTION_INVALIDATED", issue: `Knowledge dependencies changed for ${affected.join(", ")}. Refresh those contracts before dispatch.`, affectedTaskIds: affected, evidenceIds: demand.changes.map((c) => c.id).slice(0, 12) });
            continue;
          }
          const uncertain = task.knowledgeRefs.filter((r) => { const k = ir.index.knowledge?.find((k) => k.id === r.id); return !k || k.status !== "fresh" || k.validation !== "corroborated"; });
          if (uncertain.length) { await replan({ reason: "ARCHITECTURE_ASSUMPTION_INVALIDATED", taskId: task.id, issue: `Critical knowledge remains unverified: ${uncertain.map((r) => r.id).join(", ")}. Obtain scoped evidence or revise unsupported assumptions.`, evidenceIds: uncertain.map((r) => r.id).slice(0, 12) }); continue; }
          await checkpoint();
          const event = await executeTask(task);
          if (event) await replan(event);
        }
        const finalCommands = [...new Set([...plan.finalVerificationCommands, ...this.config.verification.finalCommands, ...plan.tasks.filter((t) => integrated.has(t.id)).flatMap((t) => t.verificationCommands)])];
        const allObligations: VerificationObligation[] = [...plan.projectObligations, ...plan.tasks.filter((t) => integrated.has(t.id)).flatMap((t) => t.obligations.filter((o) => o.mandatory))];
        const finalVerification = await verifier.verifyFinal(integration, finalCommands, allObligations);
        await store.writeVerification(`final-${repairAttempts}`, finalVerification);
        if (finalVerification.ok) {
          // Activate authored decisions only after their tasks AND the project are accepted.
          for (const d of ir.index.decisions ?? []) if (d.status === "proposed" && d.basis?.length && d.basis.every((b) => b.validation === "corroborated") && d.taskIds?.every((id) => integrated.has(id))) { d.status = "active"; }
          await new ProjectIrStore(this.repo).saveSnapshot(ir);
          for (const id of integrated) await store.writeArtifact(`task-state-${id}`, { state: "project_accepted", version: versions.get(id), revision: await workspace.integrationHead() });
          await checkpoint();
          await store.writeFinalPatch(await workspace.finalPatch(baseRevision));
          await store.writeMetrics(metrics);
          await store.finish("complete", { acceptedTasks: [...integrated], finalVerification, checkpointRef: workspace.checkpointRef });
          return { runId, patchPath: `${store.dir}/final.patch`, acceptedTasks: [...integrated], metricsPath: `${store.dir}/metrics.json`, checkpointRef: workspace.checkpointRef };
        }
        await workspace.resetIntegration();
        if (repairAttempts >= (this.config.budgets.projectRepairAttempts ?? 2)) throw new Error(`Project repair limit reached; ${finalVerification.failures.join("\n")}`);
        repairAttempts++;
        await checkpoint();
        const finalContract: TaskContract = { id: "project-final", version: repairAttempts, goal: "Restore project acceptance", baseRevision: await workspace.integrationHead(), writeScopes: [...new Set(plan.tasks.flatMap((t) => t.writeScopes))], constraints: [], acceptanceCriteria: [], verificationCommands: finalCommands, dependencies: [], contextHints: { files: [...new Set(plan.tasks.flatMap((t) => t.contextHints.files))], tests: [...new Set(plan.tasks.flatMap((t) => t.contextHints.tests))], symbols: [], capabilities: [] }, escalateWhen: [], knowledgeRefs: [], obligations: allObligations };
        const diagnosis = await diagnoser.inspect(integration, finalContract, { status: "local_failure", taskId: finalContract.id, contractVersion: repairAttempts, summary: "Final integration acceptance failed", changedFiles: [], checksRun: finalCommands, evidence: [], residualRisks: [] }, finalVerification, ir.index);
        await store.writeArtifact(diagnosis.id, diagnosis);
        if (["environment", "inconclusive"].includes(diagnosis.classification)) throw new Error(`Project diagnosis ${diagnosis.classification}: ${diagnosis.summary}`);
        if (diagnosis.classification === "contract") { await replan({ reason: "ARCHITECTURE_ASSUMPTION_INVALIDATED", issue: diagnosis.summary, evidenceIds: [diagnosis.id] }); continue; }
        const repair = await new RepairCoordinator(this.config, this.pi, metrics).contract(integration, plan, ir, finalVerification, allObligations, repairAttempts);
        if (plan.tasks.some((t) => t.id === repair.id)) throw new Error("Repair task id collision");
        bindTaskKnowledge(repair, ir.index);
        plan.tasks.push(repair);
        validatePlan(plan);
        await checkpoint();
      }
    } catch (error) {
      if (checkpointReady) await checkpoint();
      await store.writeMetrics(metrics);
      await store.finish("failed", { integratedPendingTasks: [...integrated], checkpointRef: workspace.checkpointRef, error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally { try { await workspace.dispose(); } finally { await release(); } }
  }
}
