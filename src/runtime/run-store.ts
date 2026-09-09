import { join } from "node:path";
import type { EvidenceRef, ProjectPlan, RunMetrics, TaskContract, VerificationResult, WorkerOutcome } from "../types.js";
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
  writeTask(task: TaskContract): Promise<void> { return writeJson(join(this.dir, "tasks", `${task.id}.json`), task); }
  writeOutcome(outcome: WorkerOutcome, attempt: number): Promise<void> {
    return writeJson(join(this.dir, "outcomes", `${outcome.taskId}-attempt-${attempt}.json`), outcome);
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
