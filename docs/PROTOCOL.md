# Coordination protocol and conformance

The runtime implements the core semantics of the generic coordination approach.
It is not a bundled installation of the external Model Coordination Skill and
makes no claim of complete conformance to its broader multi-worker design.

## ArchitectureView

`schemaVersion: 1`, indexed `revision`, repository metadata, global `moduleMap`,
detailed relevant `modules`, `interfaces`, `capabilities`, `dependencies`,
`constraints`, `decisions`, `unresolved`, and per-section `omitted` counts.

The IR schema is v2; legacy v1 files are accepted as refresh input. No source
bodies or complete `architecture.md`/`decisions.md` files are automatically
injected into the Planner. Structured decisions live in `index.json`;
`decisions.md` is retained as legacy/user-supplied background for knowledge refresh.

## EvidenceRequest / EvidencePacket

```json
{
  "question": "Which callers rely on this return shape?",
  "decision": "Preserve PaymentClient compatibility during retry changes",
  "scope": {"modules": ["payment"], "symbols": ["PaymentClient"], "files": []},
  "types": ["interfaces", "callers", "tests"]
}
```

Supported evidence types: `interfaces`, `dependencies`, `callers`, `tests`,
`behavior`, `excerpt`. All requests identify a decision and a bounded scope.
For an excerpt, include its file in `scope.files` and provide
`excerpt: {file, startLine, endLine, ambiguity}`. Obtain semantic evidence for
the same decision first; excerpts are capped at 80 lines and the configured
per-turn byte proxy budget.

A packet contains `id`, `revision`, `question`, claims with typed EvidenceRefs,
`confidence`, `exceptions`, `unresolved`, and explicit `excerpts`. EvidenceRefs
carry IDs, locators, summaries and revisions. Packet IDs are runtime-generated.
A missing/omitted claim is not a negative finding. Requests and packets are
persisted together under `runs/<run-id>/evidence/`.

## TaskContract / WorkerOutcome

A contract binds task ID/version, base commit, goal, write scopes, constraints,
acceptance criteria, runnable checks, dependencies, local context hints and
escalation conditions. Workers return task ID and active contract version with
one outcome: `candidate_ready`, `needs_context`, `local_failure`,
`contract_conflict`, `environment_failure`, `budget_exhausted`, or `blocked`.

`candidate_ready` is never acceptance. Only the independent verifier and Git
integration path can accept it. A changed contract invalidates retained Worker
context. Capability escalation uses the existing contract and candidate workspace.

For a contract conflict, provide a short semantic `conflict` describing the
incompatible requirement/interface/invariant. For a structural blocker, use:

```json
{
  "status": "blocked",
  "projectIssue": {
    "kind": "architecture_assumption_invalidated",
    "summary": "The shared interface has a different ownership boundary than planned"
  }
}
```

The other structural kind is `task_graph_blocked`. Local and environment failures
must not use this channel. Ordinary outcome fields stay in execution artifacts.

## PlannerEvent / PlanDelta

Planner events are `INITIAL_REQUIREMENT`, `CONTRACT_CONFLICT`,
`ARCHITECTURE_ASSUMPTION_INVALIDATED` and `TASK_GRAPH_BLOCKED`. Replan events
contain a bounded issue, optional task/contract version and evidence archive IDs.
They do not contain full WorkerOutcomes or diff/log payloads.

PlanDelta supplies reason, revised/added tasks, cancelled/invalidated IDs and
unaffected IDs. Validation preserves untouched tasks and rejects accepted-task
mutation, ID reuse/collisions and unschedulable/no-op changes. Revised contracts
receive a new version and a fresh task workspace/session. Invalidated tasks must
be replaced by revised specs or removed with dependencies updated.

## Artifact history

| Artifact | Meaning |
| --- | --- |
| `tasks/T1-v1.json`, `tasks/T1-v2.json` | Every dispatched contract version |
| `tasks/T1.json` | Latest dispatched version |
| `outcomes/T1-v2-attempt-1-candidate_ready.json` | Versioned task-cycle outcome |
| `T1-v2-1.verification.json` | Independent candidate checks |
| `planner-view-N-REASON.json` | Actual initial architecture projection |
| `planner-event-N.json`, `plan-delta-N.json` | Replan trigger and committed changes |
| `evidence/E-UUID.json` | Saved request and packet |
| `project-snapshot.json` | Latest accepted integration-state IR |
| `metrics.json` | Role usage and explicit context-channel byte proxies |
| `state.json`, `result.json` | Final run status, including early planning failures |

## Executable conformance checks

| Semantics | Test file |
| --- | --- |
| Planner has architecture tools and no raw repository tools | `test/planner.test.ts` |
| Role commit is terminal and duplicate commits are blocked | `test/planner.test.ts` |
| Scoped revision-pinned evidence; dirty edits excluded; budgets enforced | `test/evidence.test.ts` |
| Knowledge construction is separate, read-only and cached | `test/knowledge-builder.test.ts` |
| Local failure/needs_context reuse the Worker | `test/task-loop.test.ts` |
| Candidate verification and stronger implementation escalation | `test/task-loop.test.ts` |
| Contract v2 invalidates retained Worker state | `test/task-loop.test.ts` |
| Real worktrees, conflict cleanup, fresh v2 Worker, patch export | `test/runtime.test.ts` |
| Accepted integration refresh does not wake Planner | `test/runtime.test.ts` |
| Scope, symlink and patch-byte correctness | Existing verifier/path/workspace tests |

These checks use simulated model sessions and real filesystem/Git operations.
They establish routing and artifact behavior, not authenticated-provider quality.
