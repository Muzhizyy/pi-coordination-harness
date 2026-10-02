import { join } from "node:path";
import type { EvidencePacket, EvidenceRequest, EvidenceRef, PlanDelta, PlannerEvent, ProjectPlan, RunMetrics, TaskContract, VerificationResult, WorkerOutcome } from "../types.js";
import type { ProjectIrSnapshot } from "../project/project-ir.js";
import { ensureDir, writeJson, writeText } from "../utils/fs.js";

export class RunStore {
  readonly dir: string;
  constructor(repo: string, readonly runId: string) {
    this.dir = join(repo, ".agent-orch", "runs", runId);
  }

  async init(requirement: string, baseRevision: string): Promise<void> {
    await Promise.all([
      ensureDir(join(this.dir, "tasks")),
      ensureDir(join(this.dir, "outcomes")),
      ensureDir(join(this.dir, "evidence")),
    ]);
    await writeText(join(this.dir, "requirement.md"), `${requirement.trim()}\n`);
    await writeJson(join(this.dir, "state.json"), {
      runId: this.runId,
      baseRevision,
      status: "running",
      startedAt: new Date().toISOString(),
    });
  }

  writePlan(plan: ProjectPlan): Promise<void> { return writeJson(join(this.dir, "plan.json"), plan); }
  async writeTask(task: TaskContract): Promise<void> {
    await writeJson(join(this.dir, "tasks", `${task.id}-v${task.version}.json`), task);
    await writeJson(join(this.dir, "tasks", `${task.id}.json`), task);
  }
  writePlanDelta(delta: PlanDelta, sequence: number): Promise<void> { return writeJson(join(this.dir, `plan-delta-${sequence}.json`), delta); }
  writePlannerEvent(event: PlannerEvent, sequence: number): Promise<void> { return writeJson(join(this.dir, `planner-event-${sequence}.json`), event); }
  writeArchitectureView(reason: string, sequence: number, view: unknown): Promise<void> { return writeJson(join(this.dir, `planner-view-${sequence}-${reason}.json`), view); }
  writeProjectSnapshot(ir: ProjectIrSnapshot): Promise<void> { return writeJson(join(this.dir, "project-snapshot.json"), ir); }
  writeEvidencePacket(request: EvidenceRequest, packet: EvidencePacket): Promise<void> { return writeJson(join(this.dir, "evidence", `${packet.id}.json`), { request, packet }); }
  writeOutcome(outcome: WorkerOutcome, attempt: number): Promise<void> {
    return writeJson(join(this.dir, "outcomes", `${outcome.taskId}-v${outcome.contractVersion}-attempt-${attempt}.json`), outcome);
  }
  writeEvidence(evidence: EvidenceRef): Promise<void> { return writeJson(join(this.dir, "evidence", `${evidence.id}.json`), evidence); }
  writeVerification(name: string, result: VerificationResult): Promise<void> {
    return writeJson(join(this.dir, `${name}.verification.json`), result);
  }
  writeMetrics(metrics: RunMetrics): Promise<void> { return writeJson(join(this.dir, "metrics.json"), metrics); }
  writeFinalPatch(patch: string): Promise<void> { return writeText(join(this.dir, "final.patch"), patch); }
  async finish(status: "complete" | "failed", details: Record<string, unknown> = {}): Promise<void> {
    await writeJson(join(this.dir, "result.json"), { status, finishedAt: new Date().toISOString(), ...details });
  }
}
