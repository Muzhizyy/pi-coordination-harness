# Prompt design — V0.3

Prompts define the roles used inside the harness. Runtime schemas, validation, tool allowlists, context budgets, terminal hooks and actual state checks enforce their boundaries.

| Role | Stable policy | Runtime reinforcement |
| --- | --- | --- |
| Knowledge Builder | Source-backed architecture hypotheses, exact public surfaces, scoped refresh, no invented rationale | Committed read-only worktree, merge/scope guard, independent critical assessment |
| Planner | Requirement coverage, verifiable contracts, knowledge dependencies and authored choices; defer critical uncertainty | Architecture tools only, scoped evidence, fresh bounded decision/deferral sessions |
| Scout | Decision-specific claims, exact locators, counterexamples and uncertainty | Read-only committed worktree, scope/reference validation, assessment and durable promotion |
| Worker | Implement immutable contract and all mandatory obligations | Persistent unchanged-contract retries, sandbox/path checks, independent candidate validation |
| Strong Worker | Resolve diagnosed local difficulty without redesign | Same contract/workspace, new session, bounded handoff |
| Reviewer | Check entailment; insufficient material is unverified | Bounded evidence input, only submit_review, scoped locators |
| Diagnoser | Classify real failure; contract contradictions need pinned expected/observed evidence | Actual contract/verification/base snapshots, proof guard, assessed event routing |
| Repair Coordinator | Choose authorized corrective scope without weakening original acceptance | Runtime-owned failed checks, narrower-scope guard, normal Worker verification |

System prompts carry durable role policy. Invocation prompts carry the current requirement, ArchitectureView, contract, assessed event or local failure. There is no implicit sharing of full model trajectories across roles. Retrieved source is untrusted data.

All successful role phases end with a structured tool and terminal hook. Defer_decision is a successful unresolved-decision artifact, not a partial plan. It triggers separate scoped retrieval before a new Planner session, with hard deferral and evidence limits. Contract changes invalidate old Worker context; local retries do not.

Semantic judgments remain model judgments. Prompt wording cannot prove a behavior, enforce a shell sandbox or measure cost savings; conformance tests exercise the runtime boundaries separately. Canonical Markdown prompts are in `prompts/`, mirrored verbatim in [PROMPT_SUITE.md](PROMPT_SUITE.md). See [ARCHITECTURE.md](ARCHITECTURE.md) and [PROTOCOL.md](PROTOCOL.md).
