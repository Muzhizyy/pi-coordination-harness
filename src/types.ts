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
  reviewer?: ModelProfile;
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
    diagnosisCalls: number;
    projectRepairAttempts: number;
    plannerDeferrals: number;
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
  obligations: VerificationObligation[];
  knowledgeRefs: KnowledgeRef[];
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
  projectIssue?: { kind: "architecture_assumption_invalidated" | "task_graph_blocked"; summary: string };
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
  obligations: VerificationObligation[];
  knowledgeRefs: KnowledgeRef[];
}

export interface Requirement { id: string; description: string; mandatory: boolean }
export interface VerificationObligation {
  id: string;
  requirementId: string;
  description: string;
  category: "behavior" | "interface" | "invariant";
  mandatory: boolean;
  /** acceptance:0 / constraint:0 in the owning task. */
  covers: string[];
  check: { kind: "command"; command: string }
    | { kind: "source"; file: string; contains: string[]; notContains: string[] }
    | { kind: "review"; question: string; files: string[] };
}
export interface ObligationResult {
  id: string;
  requirementId: string;
  status: "verified" | "violated" | "unverified";
  summary: string;
  evidence: EvidenceRef[];
}
export interface KnowledgeRef { id: string; digest: string }
export interface KnowledgeRecord {
  id: string;
  kind: "fact" | "hypothesis";
  statement: string;
  source: "builder" | "scout" | "deterministic";
  sourceScope: string[];
  evidence: EvidenceRef[];
  validation: "candidate" | "corroborated" | "rejected";
  status: "fresh" | "dirty";
  revision: string;
  digest: string;
  evidenceDigest: string;
}
export interface ProjectDelta {
  fromRevision: string;
  toRevision: string;
  changedFiles: string[];
  dirtyKnowledgeIds: string[];
  changes: Array<{ id: string; kind: "added" | "changed" | "removed"; beforeDigest?: string; afterDigest?: string }>;
}
export interface DecisionProposal {
  id: string; area: string; summary: string; rationale: string;
  rejectedAlternatives: string[]; evidence: string[]; taskIds: string[];
}
export interface DiagnosticReport {
  id: string;
  classification: "implementation" | "context" | "environment" | "contract" | "inconclusive";
  summary: string;
  observations: Array<{ obligationId: string; expected: string; observed: string; evidence: EvidenceRef[] }>;
}
export interface PlannerDeferral { status: "needs_evidence"; reason: string; requests: EvidenceRequest[] }

export interface ProjectPlan {
  summary: string;
  assumptions: string[];
  tasks: PlanTaskSpec[];
  finalVerificationCommands: string[];
  requirements: Requirement[];
  projectObligations: VerificationObligation[];
  decisions: DecisionProposal[];
}

export interface PlanDelta {
  reason: string;
  revisedTasks: PlanTaskSpec[];
  addedTasks: PlanTaskSpec[];
  cancelledTaskIds: string[];
  invalidatedTaskIds: string[];
  unaffectedTaskIds: string[];
  decisions?: DecisionProposal[];
}

export interface ProjectIrIndex {
  schemaVersion: 1 | 2 | 3;
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
  knowledge?: KnowledgeRecord[];
  tree?: string;
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
  taskIds?: string[];
  status?: "proposed" | "active" | "superseded";
  revision?: string;
  /** Historical basis at decision time, preserved when the live catalogue changes. */
  basis?: Array<{ id: string; digest: string; revision: string; statement: string; evidence: EvidenceRef[]; validation: KnowledgeRecord["validation"] }>;
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
  knowledge?: KnowledgeRecord[];
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
  claims: Array<{ statement: string; evidence: EvidenceRef[]; validation?: KnowledgeRecord["validation"] }>;
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
  affectedTaskIds?: string[];
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
  obligations?: ObligationResult[];
  candidateDigest?: string;
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
  reviewer: RoleMetrics;
  diagnostic: RoleMetrics;
  repair: RoleMetrics;
  plannerContext: { architectureUnits: number; rawCodeUnits: number; evidenceRequests: number };
  plannerWakeups: Array<{ reason: string; at: string }>;
  taskAttempts: Record<string, number>;
  contractAttempts: Record<string, number>;
}
