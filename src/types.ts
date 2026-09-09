export type ThinkingLevel = "off" | "low" | "medium" | "high";

export interface ModelProfile {
  provider: string;
  model: string;
  thinkingLevel?: ThinkingLevel;
}

export interface HarnessConfig {
  planner: ModelProfile;
  worker: ModelProfile;
  strongWorker?: ModelProfile;
  sandbox: {
    enabled: boolean;
    allowNetwork: boolean;
    allowedDomains: string[];
    denyRead: string[];
    denyWrite: string[];
  };
  budgets: {
    workerVerificationRetries: number;
    fastWorkerAttempts: number;
  };
  verification: {
    finalCommands: string[];
  };
}

export interface EvidenceRef {
  id: string;
  kind: "source" | "test" | "diff" | "command" | "diagnostic" | "decision";
  locator: string;
  summary: string;
  revision?: string;
}

export interface TaskContract {
  id: string;
  version: number;
  goal: string;
  baseRevision: string;
  writeScopes: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  verificationCommands: string[];
  dependencies: string[];
  contextHints: {
    files: string[];
    symbols: string[];
    tests: string[];
    capabilities: string[];
  };
  escalateWhen: string[];
}

export type WorkerOutcomeStatus =
  | "candidate_ready"
  | "needs_context"
  | "local_failure"
  | "contract_conflict"
  | "environment_failure"
  | "budget_exhausted"
  | "blocked";

export interface WorkerOutcome {
  status: WorkerOutcomeStatus;
  taskId: string;
  contractVersion: number;
  summary: string;
  changedFiles: string[];
  checksRun: string[];
  evidence: string[];
  requestedContext?: string;
  conflict?: string;
  residualRisks: string[];
}

export interface PlanTaskSpec {
  id: string;
  goal: string;
  writeScopes: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  verificationCommands: string[];
  dependencies: string[];
  contextHints: TaskContract["contextHints"];
  escalateWhen: string[];
}

export interface ProjectPlan {
  summary: string;
  assumptions: string[];
  tasks: PlanTaskSpec[];
  finalVerificationCommands: string[];
}

export interface PlanDelta {
  reason: string;
  revisedTasks: PlanTaskSpec[];
  addedTasks: PlanTaskSpec[];
  cancelledTaskIds: string[];
  invalidatedTaskIds: string[];
  unaffectedTaskIds: string[];
}

export interface ProjectIrIndex {
  schemaVersion: 1;
  revision: string;
  generatedAt: string;
  repository: {
    name: string;
    languages: Record<string, number>;
    manifests: string[];
    trackedFileCount: number;
    topLevelEntries: string[];
  };
  modules: Array<{
    id: string;
    path: string;
    responsibility: string;
    evidence: string[];
    confidence: "high" | "medium" | "low";
  }>;
  interfaces: Array<{
    id: string;
    name: string;
    kind: string;
    location: string;
    summary: string;
    evidence: string[];
  }>;
  capabilities: Array<{
    id: string;
    name: string;
    summary: string;
    entrypoints: string[];
    examples: string[];
    evidence: string[];
  }>;
  constraints: Array<{
    id: string;
    summary: string;
    evidence: string[];
  }>;
  unresolved: string[];
}

export interface VerificationResult {
  ok: boolean;
  taskId?: string;
  changedFiles: string[];
  commands: Array<{
    command: string;
    exitCode: number;
    output: string;
  }>;
  failures: string[];
}

export interface RoleMetrics {
  calls: number;
  toolCalls: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
}

export interface RunMetrics {
  planner: RoleMetrics;
  worker: RoleMetrics;
  strongWorker: RoleMetrics;
  plannerWakeups: Array<{ reason: string; at: string }>;
  taskAttempts: Record<string, number>;
}
