# Prompt design — V0.2

Prompts define the roles used inside the harness. They are not instructions for
another agent to develop this project. Runtime tool allowlists, context projection,
terminal hooks and event routing implement the boundaries described by the prompts.

| Role | Prompt objective | Runtime reinforcement |
| --- | --- | --- |
| Knowledge Builder | Evidence-backed global responsibilities, stable surfaces, capabilities, invariants and decisions; preserve uncertainty | Fast-model profile, read-only committed snapshot, `commit_project_ir` |
| Pro Planner | Decide on architecture/task boundaries; ask for missing decision facts | No repository tools; bounded Architecture View and EvidenceRequests; fresh decision session |
| Evidence Scout | Answer one scoped question with facts, locators, exceptions and uncertainty | Read-only snapshot; bounded structured result; existing-file checks |
| Flash Worker | Continue inspect/edit/test/repair under one contract | Persistent task session, independent verifier feedback, sandbox and scope checks |
| Strong Worker | Resolve difficult implementation under the same contract | Worker role/toolset; contract conflict returns to project-event routing |

System prompts carry stable role policy. Invocation prompts carry current state:
architecture projections, TaskContracts, semantic project events and local feedback.
There is no automatic Planner trajectory injection into Workers or Worker trajectory
injection into Planner replans.

Planner source access is question-based. A semantic request must name the decision
it can affect. Excerpts require preceding semantic evidence, an explicit ambiguity
and a small scoped line range. Runtime counters bound the explicit channels;
semantic claims remain model-generated and can still be incomplete or incorrect.

Every phase ends with a structured commit/outcome tool. Terminal hooks abort after
capture rather than relying on a prose request to stop. Local verification failures
retain Worker history. Contract changes require a new version and session, preventing
old debugging assumptions from silently surviving a replan.

The canonical prompts are Markdown files in `prompts/`; [PROMPT_SUITE.md](PROMPT_SUITE.md)
is a synchronized review copy. [ARCHITECTURE.md](ARCHITECTURE.md) explains control flow;
[PROTOCOL.md](PROTOCOL.md) lists interfaces and executable conformance checks.
