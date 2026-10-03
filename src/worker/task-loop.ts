import type { DiagnosticReport, HarnessConfig, PlannerEvent, TaskContract, VerificationResult, WorkerOutcome } from "../types.js";
import { assertActiveOutcome, projectEvent } from "../runtime/events.js";

export interface TaskWorker {
  start(contract: TaskContract, context: string): Promise<WorkerOutcome>;
  retry(contract: TaskContract, feedback: string): Promise<WorkerOutcome>;
  execSandboxed(command: string): Promise<{ exitCode: number; output: string }>;
  dispose(): Promise<void>;
}
export interface TaskLoopHooks {
  outcome(outcome: WorkerOutcome, attempt: number): Promise<void>;
  verification(result: VerificationResult, attempt: number): Promise<void>;
  context(question: string): Promise<string>;
  diagnose(outcome: WorkerOutcome, verification?: VerificationResult): Promise<DiagnosticReport>;
  attempt(): void;
}
export type TaskLoopResult = { status: "verified"; outcome: WorkerOutcome; verification: VerificationResult } | { status: "project_event"; event: PlannerEvent };

/** Local retries are bounded; escalation requires an independent diagnostic classification. */
export class WorkerTaskLoop {
  constructor(private readonly config: HarnessConfig, private readonly createWorker: (role: "worker" | "strongWorker") => TaskWorker,
    private readonly verify: (worker: TaskWorker) => Promise<VerificationResult>, private readonly hooks: TaskLoopHooks) {}
  async execute(contract: TaskContract, context: string): Promise<TaskLoopResult> {
    let worker = this.createWorker("worker");
    let strong = false, attempts = 0, verificationRetries = 0, diagnosisCalls = 0;
    let roleAttempts = 0;
    let lastVerification: VerificationResult | undefined;
    let diagnosed: DiagnosticReport | undefined;
    const invoke = async (call: () => Promise<WorkerOutcome>): Promise<WorkerOutcome> => {
      attempts++; roleAttempts++; this.hooks.attempt();
      try { return await call(); }
      catch (error) { return { taskId: contract.id, contractVersion: contract.version, status: "budget_exhausted", summary: String(error).slice(0, 1000), changedFiles: [], checksRun: [], evidence: [], residualRisks: [] }; }
    };
    try {
      let outcome = await invoke(() => worker.start(contract, context));
      while (true) {
        assertActiveOutcome(outcome, contract);
        await this.hooks.outcome(outcome, attempts);
        if (outcome.status === "candidate_ready") {
          lastVerification = await this.verify(worker);
          await this.hooks.verification(lastVerification, attempts);
          if (lastVerification.ok) return { status: "verified", outcome, verification: lastVerification };
          if (verificationRetries++ < this.config.budgets.workerVerificationRetries) {
            outcome = await invoke(() => worker.retry(contract, JSON.stringify(lastVerification)));
            continue;
          }
          outcome = { ...outcome, status: "local_failure", summary: "Verification retry budget exhausted" };
        }
        if (outcome.status === "needs_context" && roleAttempts < this.config.budgets.fastWorkerAttempts) {
          const additional = await this.hooks.context(outcome.requestedContext ?? contract.goal);
          outcome = await invoke(() => worker.retry(contract, additional));
          continue;
        }
        const disputed = ["contract_conflict", "blocked", "environment_failure", "needs_context"].includes(outcome.status);
        const exhausted = roleAttempts >= this.config.budgets.fastWorkerAttempts || verificationRetries > this.config.budgets.workerVerificationRetries;
        if ((disputed || exhausted) && !diagnosed) {
          if (++diagnosisCalls > (this.config.budgets.diagnosisCalls ?? 2)) throw new Error(`Task ${contract.id} exhausted diagnosis budget`);
          diagnosed = await this.hooks.diagnose(outcome, lastVerification);
        }
        const event = projectEvent(outcome, diagnosed);
        if (event) return { status: "project_event", event };
        if (diagnosed && ["environment", "inconclusive"].includes(diagnosed.classification)) throw new Error(`Task ${contract.id} diagnosis: ${diagnosed.classification}: ${diagnosed.summary}`);
        if (!exhausted && outcome.status !== "environment_failure") {
          const feedback = diagnosed?.classification === "context" ? await this.hooks.context(diagnosed.summary) : `Continue under the SAME contract. ${diagnosed?.summary ?? outcome.summary}\n${JSON.stringify(lastVerification ?? {})}`;
          outcome = await invoke(() => worker.retry(contract, feedback));
          continue;
        }
        if (!strong && this.config.strongWorker && diagnosed && ["implementation", "context"].includes(diagnosed.classification)) {
          const diagnosticFeedback = JSON.stringify(diagnosed);
          await worker.dispose();
          strong = true; roleAttempts = 0; verificationRetries = 0; diagnosed = undefined;
          worker = this.createWorker("strongWorker");
          outcome = await invoke(() => worker.start(contract, `${context}\nIndependent diagnosis: ${diagnosticFeedback}\n${JSON.stringify(lastVerification)}`));
          continue;
        }
        throw new Error(`Task ${contract.id} failed with ${outcome.status}: ${diagnosed?.summary ?? outcome.summary}`);
      }
    } finally { await worker.dispose(); }
  }
}
