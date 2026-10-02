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
  scout?: ModelProfile;
  plannerContext: {
    architectureTokens: number;
    rawCodeTokens: number;
    evidenceRequests: number;
  };
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
  schemaVersion: 1 | 2;
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
    nonResponsibilities?: string[];
    publicInterfaces?: string[];
    tests?: string[];
  }>;
  interfaces: Array<{
    id: string;
    name: string;
    kind: string;
    location: string;
    summary: string;
    evidence: string[];
    owner?: string;
    stability?: "public" | "internal";
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
  dependencies?: ArchitectureDependency[];
  decisions?: ArchitectureDecision[];
}

export interface ArchitectureDependency {
  from: string;
  to: string;
  kind: "import" | "semantic";
  evidence: string[];
}

export interface ArchitectureDecision {
  id: string;
  area: string;
  summary: string;
  rationale: string;
  rejectedAlternatives: string[];
  evidence: string[];
}

export interface ArchitectureView {
  schemaVersion: 1;
  revision: string;
  repository: ProjectIrIndex["repository"];
  moduleMap: Array<{ id: string; responsibility: string }>;
  modules: ProjectIrIndex["modules"];
  interfaces: ProjectIrIndex["interfaces"];
  capabilities: ProjectIrIndex["capabilities"];
  dependencies: ArchitectureDependency[];
  constraints: ProjectIrIndex["constraints"];
  decisions: ArchitectureDecision[];
  unresolved: string[];
  omitted: Record<string, number>;
}

export interface EvidenceRequest {
  question: string;
  decision: string;
  scope: { modules: string[]; symbols: string[]; files: string[] };
  types: Array<"interfaces" | "dependencies" | "callers" | "tests" | "behavior" | "excerpt">;
  excerpt?: { file: string; startLine: number; endLine: number; ambiguity: string };
}

export interface EvidencePacket {
  id: string;
  revision: string;
  question: string;
  claims: Array<{ statement: string; evidence: EvidenceRef[] }>;
  confidence: "high" | "medium" | "low";
  exceptions: string[];
  unresolved: string[];
  excerpts: Array<{ locator: string; source: string }>;
}

export type PlannerEventReason = "INITIAL_REQUIREMENT" | "CONTRACT_CONFLICT" | "ARCHITECTURE_ASSUMPTION_INVALIDATED" | "TASK_GRAPH_BLOCKED";

export interface PlannerEvent {
  reason: Exclude<PlannerEventReason, "INITIAL_REQUIREMENT">;
  taskId?: string;
  contractVersion?: number;
  issue: string;
  evidenceIds: string[];
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
  scout: RoleMetrics;
  knowledgeBuilder: RoleMetrics;
  plannerContext: { architectureUnits: number; rawCodeUnits: number; evidenceRequests: number };
  plannerWakeups: Array<{ reason: string; at: string }>;
  taskAttempts: Record<string, number>;
}
