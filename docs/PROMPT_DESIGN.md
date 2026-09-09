# Prompt Architecture

The prompts are part of the runtime protocol. They are intentionally role- and phase-specific instead of sharing one universal coding-agent system prompt.

## Design principles

1. **System prompts define stable role invariants.** They specify what the role owns, what it must ignore, and its termination semantics.
2. **Invocation prompts carry current state.** Project IR, TaskContract, current plan and verification evidence are injected explicitly rather than hidden in accumulated chat history.
3. **Structured tools are the exit protocol.** Planner and Worker completion is recognized by tool calls, not prose.
4. **Planner prompts minimize implementation leakage.** They ask for task boundaries, contracts and architecture decisions, not code for the worker to copy.
5. **Worker retries preserve local history.** A failed deterministic check is returned to the same session with a retry packet instead of restarting repository understanding.
6. **Replanning is evidence-scoped.** Only project-level conflict evidence is shown to the planner; worker transcripts remain private to the task session.

## Prompt set

| Prompt | Role | Trigger | Context center | Required exit |
|---|---|---|---|---|
| `project-bootstrap-system.md` | architecture bootstrapper | first repository use | deterministic inventory + targeted source evidence | `commit_project_ir` |
| `project-bootstrap-request.md` | architecture bootstrapper | first repository use | repository structure | `commit_project_ir` |
| `project-refresh-request.md` | architecture bootstrapper | Git revision changed | previous IR + changed files | `commit_project_ir` |
| `planner-system.md` | planner | all planning events | project model / task boundaries | phase commit tool |
| `planner-initial.md` | planner | new requirement | requirement + IR + decisions | `commit_plan` |
| `planner-replan.md` | planner | contract conflict | current plan + narrow evidence | `commit_plan_delta` |
| `worker-system.md` | fast worker | bounded implementation | task-local code/debug state | `submit_outcome` |
| `worker-task.md` | fast worker | first attempt | TaskContract + IR slice | `submit_outcome` |
| `worker-retry.md` | same worker | verifier/local failure | same contract + new evidence | `submit_outcome` |
| `strong-worker-system.md` | strong worker | capability escalation | same TaskContract + previous failure | `submit_outcome` |

## Planner system prompt: why it is restrictive

The planner's value is global reasoning. Giving it an unrestricted coding loop would turn it back into a normal coding agent and steadily pull implementation logs into expensive context. Therefore the prompt makes three things explicit:

- project-level optimization objective;
- code inspection only when it can alter task boundaries or acceptance;
- immediate termination after a structured plan mutation.

The runtime reinforces these instructions by withholding edit/write/bash tools.

## Worker system prompt: why it is persistent

The worker's value is repeated local execution. Its system prompt makes ordinary syntax/test/debug failure an inner-loop responsibility. A verifier failure is sent back into the same Pi session so useful local observations remain available. Only evidence that invalidates the contract crosses the planner boundary.

## Strong worker is not a second planner

A larger coding model may be useful when a fast model cannot implement a still-valid contract. The escalation prompt explicitly preserves the same task boundary. If it discovers the contract itself is wrong, it must return `contract_conflict` rather than redesign the project silently.

## Project IR prompts

The bootstrap prompt intentionally asks for durable architecture, interfaces, reusable capabilities and constraints instead of a prose summary of every directory. The refresh prompt receives the previous IR and Git changed-file set and asks for the complete refreshed IR while minimizing architecture churn.

This makes repository understanding an amortizable project asset rather than a repeated hidden prelude to every issue.
