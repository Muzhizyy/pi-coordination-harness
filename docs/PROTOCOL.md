# Coordination protocol — V0.3

The protocol defines runtime authority, not full conformance to any external coordination skill. TypeScript types are in `src/types.ts`; model tool schemas are in `src/planner/tools.ts` and `protocol-schema.ts`; runtime validation supplements those schemas.

## Requirement and obligations

ProjectPlan adds `requirements`, `projectObligations` and `decisions`. Every mandatory requirement needs a mandatory project obligation. All task/project obligation ids are unique across the plan and reference a known requirement.

```json
{
  "id": "T1.pagination",
  "requirementId": "R1",
  "description": "Existing fields remain compatible and the next cursor advances",
  "category": "behavior",
  "mandatory": true,
  "covers": ["acceptance:0", "constraint:0"],
  "check": {"kind": "command", "command": "npm test -- pagination"}
}
```

Other check shapes: `{kind:"source", file, contains:string[], notContains:string[]}` with at least one non-empty pattern; `{kind:"review", question, files:string[]}` with a concrete question and non-empty evidence scope. Categories are `behavior`, `interface`, `invariant`.

Task `acceptanceCriteria[N]` requires mandatory coverage `acceptance:N`; `constraints[N]` requires `constraint:N`. Commands alone or criteria alone are not a migration substitute. Every task has at least one mandatory obligation. `verificationCommands` are extra blocking checks. Optional obligations may be violated/unverified without blocking mandatory acceptance; their reports remain visible.

ObligationResult contains id, requirementId, `verified|violated|unverified`, summary and EvidenceRefs. Results are pinned to `candidate:<digest>` for uncommitted candidates. A candidate mutation invalidates every result. Literal assertions prove literal text conditions, not arbitrary behavior.

## TaskContract and immutable retries

TaskContract retains id/version/goal/baseRevision/writeScopes/constraints/acceptanceCriteria/verificationCommands/dependencies/contextHints/escalateWhen and adds `obligations` and `knowledgeRefs:[{id,digest}]`.

Runtime automatically binds structural references from write scopes and hints. Dispatch checks digest identity, fresh status and corroborated validation. Replanning revises/retire affected tasks, increments revised versions and creates fresh worktrees/sessions. Integrated contracts are immutable; defects require forward corrective work.

WorkerOutcome remains `candidate_ready|needs_context|local_failure|contract_conflict|environment_failure|budget_exhausted|blocked`, with taskId/contractVersion, summary, changedFiles, checksRun, evidence, optional requestedContext/conflict/projectIssue, residualRisks. This artifact is a claim, never task/project acceptance. `projectIssue` is a diagnostic hint, not an event override.

## Knowledge and delta

IR schema v3 adds Git tree identity and `knowledge`. Legacy v1/v2 indexes are bootstrap/refresh input, not trusted v3 assessments. KnowledgeRecord fields:

| Field | Meaning |
| --- | --- |
| `id`, `statement` | Stable semantic record and its claim |
| `kind` | `fact` or `hypothesis` |
| `source` | `builder`, `scout` or `deterministic` |
| `sourceScope`, `evidence` | Impact scopes and revision-pinned references |
| `validation` | `candidate`, `corroborated` or `rejected` |
| `status` | `fresh` or `dirty` |
| `revision`, `digest`, `evidenceDigest` | Indexed revision, semantic hash, evidence-scope fingerprint |

Matching revision/file existence does not establish semantic support. Model claims require independent evidence assessment when critical. Scoped refresh returns selected semantic entries and optional `removedKnowledgeIds`; unrelated entries are merged unchanged, with dirty status retained. Builder does not own `decisions`.

ProjectDelta contains fromRevision/toRevision, actual changedFiles, dirtyKnowledgeIds, changes `{id, kind:added|changed|removed, beforeDigest?,afterDigest?}`. The integration delta initially records dirty markers; demand-time refresh records actual semantic changes. Changed/removed/rejected bound records invalidate pending contracts; new global constraints impact pending work. `affectedTaskIds` identifies contracts a delta must revise/retire.

## ArchitectureView, evidence and deferral

ArchitectureView schema remains 1 and adds prioritized knowledge records with explicit validation/freshness. It retains repository/module/interface/capability/dependency/constraint/decision/unresolved sections and omitted counts. No full architecture prose, source bodies or Worker trajectories are automatically injected.

EvidenceRequest identifies question, decision, scope `{modules,symbols,files}` and types `interfaces|dependencies|callers|tests|behavior|excerpt`. EvidencePacket contains generated id, revision, question, claims with EvidenceRefs/validation, confidence, exceptions, unresolved, explicit excerpts.

Scout evidence must remain inside requested file/module boundaries. References are checked for committed blob, protected paths and valid line range. Independent Reviewer tests semantic support before promoting Scout claims. Negative or uncertain claims remain in the catalogue as hypotheses/rejections. Exact-tree caches can reuse results after rebinding revisions; changing a tree invalidates cache reuse.

Excerpts require earlier semantic evidence for the same decision, an ambiguity, a file in scope.files and 1–80 lines. Explicit raw and semantic bytes have separate budgets. Default data budgets: 12000 semantic, 2000 raw, 6 requests. These are UTF-8 proxies, not full provider token accounting.

`defer_decision` terminates with `{status:"needs_evidence", reason, requests}` (1–3 semantic requests). Runtime retrieves evidence and resumes planning in a new session. Default maximum two deferrals; unresolved/budget-exhausted planning fails closed. `inspect_task` retrieves full contracts during replanning while the initial graph payload remains coarse.

## Diagnosis and Planner events

DiagnosticReport has generated id, classification `implementation|context|environment|contract|inconclusive`, bounded summary and observations `{obligationId,expected,observed,evidence}`.

Expected text must match an actual obligation description or a bound knowledge statement (`knowledge:<record-id>`). Contract classification needs a scoped reference at the exact baseRevision and concrete expected/observed proof; candidate edits or Worker status are insufficient. Runtime projects assessed diagnosis into a short PlannerEvent. Bound-knowledge contradiction uses ARCHITECTURE_ASSUMPTION_INVALIDATED; other task-contract contradictions use CONTRACT_CONFLICT. Actual unschedulable graph state uses TASK_GRAPH_BLOCKED. INITIAL_REQUIREMENT is the initial decision reason.

PlanDelta preserves reason, revisedTasks, addedTasks, cancelledTaskIds, invalidatedTaskIds, unaffectedTaskIds and optional authored decisions. Validation rejects unsafe ids, duplicates, unknown changes, accepted-task mutations, cycles, retired id reuse, no-op deltas and omission of affected invalid contracts. Requirement/project acceptance does not have a weakening delta channel. Planner events have issue, evidenceIds, optional task/version and affectedTaskIds; they omit raw debug logs/diffs.

## Project repair and decisions

Final verification repeats project obligations plus mandatory integrated-task obligations and all integrated/planned/configured commands. Failure diagnostics precede a repair contract. Repair Coordinator chooses only authorized/narrower scopes; runtime attaches original failed obligations with new unique ids/coverage. Every correction is independently verified and integrated, then full acceptance repeats. Defaults: two project repair rounds, eight project replans.

DecisionProposal has id/area/summary/rationale/rejectedAlternatives/evidence/taskIds. Evidence ids reference catalogue records, contained EvidenceRefs or `requirement:<id>`. Runtime independently demands decision knowledge and copies a historical basis. A proposed decision activates only after corroborated basis, linked task integration and full project acceptance; cancellation supersedes it. Existing active decisions require a new id for a new choice. Legacy unauthored records remain superseded.

## Checkpoints and artifacts

| Artifact | Meaning |
| --- | --- |
| `tasks/T1-vN.json`, `tasks/T1.json` | Every dispatched contract, latest dispatch |
| `outcomes/…json`, `T1-vN-attempt.verification.json` | Reported outcome and independently observed checks |
| `task-state-T1.json` | Current running/verified/integrated_pending/project_accepted/failed/invalid state |
| `planner-view-*`, `planner-deferral-*`, `planner-event-*`, `plan-delta-*` | Decision inputs, unresolved requests, triggers and plan changes |
| `project-delta-*`, `knowledge-impact-*` | Dirty propagation and semantic change evidence |
| `evidence/E-*.json`, `diagnostic-*.json` | Bounded evidence requests/results and classifications |
| `checkpoint.json` and Git retention ref | Resumable accepted integration state and budgets |
| `project-snapshot.json`, project cache | Revision-tagged knowledge, potentially with deferred dirty entries |
| `final-N.verification.json` | Each complete integration acceptance attempt |
| `metrics.json`, `state.json`, `result.json` | Role use, explicit budgets and terminal status |
| `final.patch` | Exported only from complete project acceptance |

RunCheckpoint schema 1 includes runId, requirement, original base, integrationRevision, configDigest, plan, ir, integrated/cancelled task ids, contract versions, repair/replan counters, artifact sequence and metrics. Git ref: `refs/pi-coordination/runs/<id>/integration`. Atomic JSON plus reachable commits retain progress after worktree cleanup.

Per-contract attempt counters persist across resume, preserving all outcome/verification cycles without overwrites.

Resume requires original config/base HEAD and consistent retained history. It refuses completed runs and overlapping live resume on the same local host. It restarts unfinished Workers, preserving already integrated tasks. Failure before a valid plan/checkpoint requires a new run after remediation.

## Conformance

`test/mechanisms.test.ts` covers uncovered obligations, semantic uncertainty, selective pending invalidation, unchanged unaffected versions, final repair, environment-interrupted resume, unsupported conflicts, Scout promotion/rejection, tree cache reuse, fresh deferred decisions, oscillating repair budgets, optional results, mutation invalidation, scope-derived references, new scoped constraints, historical decision bases and run leases. Other tests retain committed-source/scopes/budgets/version/worktree/patch checks. Models are simulated; filesystem and Git operations are real. See [VALIDATION.md](VALIDATION.md) for what was actually executed.
