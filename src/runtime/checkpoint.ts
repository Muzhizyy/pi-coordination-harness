import type { ProjectIrSnapshot } from "../project/project-ir.js";
import type { ProjectPlan, RunMetrics } from "../types.js";
export interface RunCheckpoint {
  schemaVersion: 1;
  runId: string;
  requirement: string;
  baseRevision: string;
  integrationRevision: string;
  configDigest: string;
  plan: ProjectPlan;
  ir: ProjectIrSnapshot;
  integratedTasks: string[];
  cancelledTasks: string[];
  versions: Array<[string, number]>;
  repairAttempts: number;
  replans: number;
  sequence: number;
  metrics: RunMetrics;
}
