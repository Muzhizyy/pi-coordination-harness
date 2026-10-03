# V0.3 mechanism repair plan

Scope: repair the six reviewed mechanism gaps while retaining the serial scheduler, isolated task worktrees, short-lived architecture Planner and persistent local Worker retries. This is a local source update; publication is separate.

| Phase | Mechanism change | Acceptance evidence | Status |
| --- | --- | --- | --- |
| 1. Define acceptance | Requirement ids → explicit task/project obligations → typed verification evidence; mandatory coverage fails closed | Missing obligations/constraint coverage and semantic uncertainty are rejected | Complete |
| 2. Make knowledge accountable | Candidate hypotheses, corroborated facts, dirty markers, scoped evidence, authored decisions and historical bases | Entailment assessment, rejected Scout claims, retained decision bases | Complete |
| 3. Propagate change on demand | Bind structural knowledge hashes; dirty on integration, refresh next-task dependencies, impact only pending contracts; allow Planner deferral | Changed public assumption revises dependent task to v2; unrelated task remains v1; fresh deferred planning session | Complete |
| 4. Close failure loops | Diagnose before escalation; bounded corrective contracts; repeat original integrated acceptance; retain Git/checkpoint state for resume | Misreported conflicts stay local; final repair succeeds; interrupted repair resumes without repeating completed tasks | Complete |
| 5. Harden recovery | Persist budgets and integration history; prevent concurrent resume; reject verification mutation; retain historical decision proof | Oscillating repair stops at limit; optional failure reporting; lease checks; exact candidate evidence | Complete |
| 6. Document and package | Synchronize role prompts, schemas, full Chinese mechanism, migration/config and actual validation record | Type check, full suite, clean build, prompt mirror, package and bundle restoration checks | Complete |

The protocol additions are interdependent: obligation coverage, knowledge binding, diagnosed routing and project acceptance must enter the runtime together. The first coherent implementation commit is `29f1c9c`; recovery/proof hardening follows in `f3305fe`. Recovery attempt-history preservation follows in `42e914d`; subsequent commits record prompt/documentation and verification improvements. Existing Git history is preserved; no history is fabricated or squashed.

No automatic concurrency scheduler, open-ended repair, speculative performance claims or silently weakened acceptance is introduced. Rolling milestone planning is a possible future extension; this version implements evidence deferral and demand-driven knowledge without claiming a milestone protocol.
