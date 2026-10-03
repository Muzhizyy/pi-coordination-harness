import type { PlanTaskSpec, ProjectPlan, VerificationObligation } from "../types.js";

export function validateObligations(obligations: VerificationObligation[]): void {
  if (!Array.isArray(obligations) || !obligations.length) throw new Error("Explicit verification obligations are required; legacy string criteria must be migrated");
  const ids = new Set<string>();
  for (const o of obligations) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(o.id) || ids.has(o.id)) throw new Error(`Invalid or duplicate obligation id: ${o.id}`);
    ids.add(o.id);
    if (!o.description?.trim() || !o.requirementId?.trim() || typeof o.mandatory !== "boolean" || !Array.isArray(o.covers)) throw new Error(`Incomplete obligation: ${o.id}`);
    if (!["behavior", "interface", "invariant"].includes(o.category)) throw new Error(`Invalid obligation category: ${o.id}`);
    const c = o.check;
    if (!c || !["command", "source", "review"].includes(c.kind)) throw new Error(`Invalid check: ${o.id}`);
    if (c.kind === "command" && !c.command.trim()) throw new Error(`Empty verification command: ${o.id}`);
    if (c.kind === "source" && (!c.file || ![...c.contains, ...c.notContains].length || [...c.contains, ...c.notContains].some((s) => !s))) throw new Error(`Source assertions need non-empty patterns: ${o.id}`);
    if (c.kind === "review" && (!c.question.trim() || !c.files.length)) throw new Error(`Semantic reviews need a question and scoped files: ${o.id}`);
  }
}

export function validateTaskObligations(task: PlanTaskSpec): void {
  validateObligations(task.obligations);
  if (!task.obligations.some((o) => o.mandatory)) throw new Error(`Task ${task.id} needs mandatory obligations`);
  for (const [prefix, items] of [["acceptance", task.acceptanceCriteria], ["constraint", task.constraints]] as const) {
    for (let i = 0; i < items.length; i++) if (!task.obligations.some((o) => o.mandatory && o.covers.includes(`${prefix}:${i}`))) {
      throw new Error(`Task ${task.id} has uncovered ${prefix}:${i}`);
    }
  }
  for (const o of task.obligations) for (const cover of o.covers) {
    const match = cover.match(/^(acceptance|constraint):(\d+)$/);
    if (!match || Number(match[2]) >= (match[1] === "acceptance" ? task.acceptanceCriteria : task.constraints).length) throw new Error(`Invalid coverage reference: ${cover}`);
  }
  if (!Array.isArray(task.knowledgeRefs)) throw new Error(`Task ${task.id} must declare knowledgeRefs (empty is allowed)`);
}

export function validateCoverage(plan: ProjectPlan): void {
  if (!Array.isArray(plan.requirements) || !plan.requirements.length) throw new Error("Plan must enumerate requirement ids");
  const requirements = new Set<string>();
  for (const r of plan.requirements) {
    if (!r.id?.trim() || requirements.has(r.id) || !r.description.trim() || typeof r.mandatory !== "boolean") throw new Error(`Invalid or duplicate requirement: ${r.id}`);
    requirements.add(r.id);
  }
  validateObligations(plan.projectObligations);
  const all = [...plan.projectObligations, ...plan.tasks.flatMap((t) => t.obligations)];
  const ids = new Set<string>();
  for (const o of all) {
    if (ids.has(o.id)) throw new Error(`Obligation ids must be unique across the plan: ${o.id}`);
    ids.add(o.id);
    if (!requirements.has(o.requirementId)) throw new Error(`Unknown requirement: ${o.requirementId}`);
  }
  for (const r of plan.requirements.filter((r) => r.mandatory)) if (!plan.projectObligations.some((o) => o.requirementId === r.id && o.mandatory)) throw new Error(`Project acceptance does not cover requirement ${r.id}`);
}
