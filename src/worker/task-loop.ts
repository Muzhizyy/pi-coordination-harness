import type { HarnessConfig, PlannerEvent, TaskContract, VerificationResult, WorkerOutcome } from "../types.js";
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
  attempt(): void;
}

export type TaskLoopResult =
  | { status: "verified"; outcome: WorkerOutcome; verification: VerificationResult }
  | { status: "project_event"; event: PlannerEvent };

/** This loop has no Planner dependency. Local feedback stays with its Worker. */
export class WorkerTaskLoop {
  constructor(private readonly config: HarnessConfig, private readonly createWorker: (role: "worker" | "strongWorker") => TaskWorker,
    private readonly verify: (worker: TaskWorker) => Promise<VerificationResult>, private readonly hooks: TaskLoopHooks) {}

  async execute(contract: TaskContract, context: string): Promise<TaskLoopResult> {
    let worker = this.createWorker("worker");
    let strong = false;
    let attempts = 0;
    let verificationRetries = 0;
    let verificationExhausted = false;
    const invoke = async (call: () => Promise<WorkerOutcome>) => { attempts++; this.hooks.attempt(); return call(); };
    try {
      let outcome = await invoke(() => worker.start(contract, context));
      while (true) {
        assertActiveOutcome(outcome, contract);
        await this.hooks.outcome(outcome, attempts);
        const event = projectEvent(outcome);
        if (event) return { status: "project_event", event };
        if (outcome.status === "candidate_ready") {
          const verification = await this.verify(worker);
          await this.hooks.verification(verification, attempts);
          if (verification.ok) return { status: "verified", outcome, verification };
          if (verificationRetries < this.config.budgets.workerVerificationRetries) {
            verificationRetries++;
            outcome = await invoke(() => worker.retry(contract, verification.failures.join("\n\n")));
            continue;
          }
          outcome = { ...outcome, status: "local_failure", summary: "Deterministic verification retry budget exhausted", evidence: [...outcome.evidence, ...verification.failures] };
          verificationExhausted = true;
          await this.hooks.outcome(outcome, attempts);
        }
        if (outcome.status === "needs_context") {
          if (attempts >= this.config.budgets.fastWorkerAttempts) throw new Error(`Task ${contract.id} exhausted its context retry budget`);
          const additional = await this.hooks.context(outcome.requestedContext ?? contract.goal);
          outcome = await invoke(() => worker.retry(contract, additional));
          continue;
        }
        if (outcome.status === "local_failure" || outcome.status === "budget_exhausted") {
          if (!strong && !verificationExhausted && attempts < this.config.budgets.fastWorkerAttempts) {
            const feedback = `Local failure: ${outcome.summary}\n${outcome.evidence.join("\n")}`;
            outcome = await invoke(() => worker.retry(contract, feedback));
            continue;
          }
          if (!strong && this.config.strongWorker) {
            strong = true;
            verificationRetries = 0;
            verificationExhausted = false;
            await worker.dispose();
            worker = this.createWorker("strongWorker");
            const feedback = `${context}\n\nPrevious implementation failure under the same contract:\n${JSON.stringify(outcome)}`;
            outcome = await invoke(() => worker.start(contract, feedback));
            continue;
          }
        }
        throw new Error(`Task ${contract.id} failed with ${outcome.status}: ${outcome.summary}`);
      }
    } finally { await worker.dispose(); }
  }
}
