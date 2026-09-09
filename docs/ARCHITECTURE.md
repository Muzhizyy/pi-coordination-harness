# Architecture

Pi Role Harness is a role-specialized coding-agent control plane built on top of Pi primitives rather than Pi's default single-agent semantics.

## Top-level flow

```text
Repository
   │
   ├─ first use / revision change ──> Project IR bootstrap / refresh
   │                                    │
   │                                    ▼
User requirement ───────────────> Project Runtime
                                      │
                                      ├─ project-level event ──> Planner Runtime
                                      │                           read-only + short-lived
                                      │                           Project IR → Plan / PlanDelta
                                      │
                                      └─ ready TaskContract ───> Worker Runtime
                                                                  persistent task session
                                                                  inspect → edit → test → retry
                                                                          │
                                                                  WorkerOutcome
                                                                          │
                                                           deterministic verifier
                                                               │          │
                                                              pass       fail
                                                               │          │
                                                        integrate      same worker
                                                                          │
                                                  contract conflict only
                                                                          ▼
                                                                       Planner
```

## Shared substrate, different harness semantics

Pi supplies model resolution, message/tool calling, sessions, built-in coding tools, custom tool registration and extension hooks. This project deliberately does not use one generic `agent.run()` abstraction for both roles.

### Planner runtime

The planner is an event-triggered control-plane role. A planner invocation has one project-level question to settle and then terminates. Its default context is Project IR, durable decisions, the current plan, and narrowly scoped evidence. It has read-only repository tools plus a single structured commit tool (`commit_project_ir`, `commit_plan`, or `commit_plan_delta`).

Planner entry events in V1:

- Project IR bootstrap or revision refresh
- Initial requirement planning
- Worker `contract_conflict`

Local syntax, unit-test and debugging failures are intentionally excluded.

### Worker runtime

A worker owns one `TaskContract`. Its Pi session stays alive across local verification failures so recent debugging state is retained. It receives a local Project IR slice plus concrete repository access, not the planner transcript. It can read/edit/write and use sandboxed bash, but must terminate each decision cycle with `submit_outcome`.

Worker outcomes are control-plane signals:

- `candidate_ready`
- `needs_context`
- `local_failure`
- `contract_conflict`
- `environment_failure`
- `budget_exhausted`
- `blocked`

A fast worker can escalate to a stronger coding model without waking the planner when the contract remains valid.

## Context architecture

Context is a projection of external state, not just compressed conversation history.

```text
                    Project IR
                 /              \
        Planner projection    Worker projection
        modules/interfaces    task contract
        constraints           relevant modules
        decisions             reusable capabilities
        plan/evidence         concrete source/tests
                 \              /
                  Execution evidence
```

The harness disables automatic Pi skills/extensions/context-file discovery inside role sessions. Each role receives only resources selected by the harness plus explicitly registered inline safety extensions. This keeps role boundaries observable and testable.

## Project IR lifecycle

Project IR lives under `.agent-orch/project/` and is reused across runs.

- Missing IR: deterministic repository inventory + strong read-only bootstrap.
- Matching Git revision: reuse without another architecture pass.
- Changed Git revision: calculate changed tracked files and ask the bootstrap role for a targeted refresh of affected architectural facts while preserving valid knowledge.

IR claims are expected to remain evidence-backed and uncertainty-aware.

## Isolation and acceptance

Each task executes in a temporary detached Git worktree. Bash is wrapped with the same `@anthropic-ai/sandbox-runtime` mechanism used by Pi's official sandbox example. Built-in file tools are additionally guarded against lexical and symlink path escape. Sensitive write patterns are blocked.

The task's declared write scope is checked again against the actual Git diff at acceptance time. This acceptance-time check is authoritative even when a model or shell command bypasses an intended convention.

A worker cannot mark a task accepted. `candidate_ready` triggers deterministic verification. Only a verified task commit is cherry-picked into the temporary integration worktree.

## State and artifacts

Durable project knowledge:

```text
.agent-orch/project/
  manifest.json
  inventory.json
  architecture.md
  index.json
  decisions.md
```

Per-run execution state:

```text
.agent-orch/runs/<run-id>/
  requirement.md
  state.json
  plan.json
  tasks/
  outcomes/
  verification/
  metrics.json
  final.patch
```

The user's working tree is not modified by the harness. The final product of a successful run is a patch plus an auditable run trace.

## V1 non-goals

- Parallel worker scheduling and merge-conflict resolution
- Learned routing or planner/worker training
- Full semantic program analysis
- Arbitrary-process crash recovery
- IDE/TUI integration
