Create the project-level execution plan for this requirement.

## Original requirement
{{REQUIREMENT}}

## Architecture IR
{{ARCHITECTURE}}

## Project index
{{PROJECT_INDEX}}

## Durable decisions
{{DECISIONS}}

Before committing, use targeted read-only inspection only if an unresolved fact can materially change task boundaries or acceptance. Prefer the repository's existing capabilities.

Task contracts must be self-contained for a worker that will NOT receive this planning conversation. Verification commands must be real commands appropriate for this repository, not prose.

Call `commit_plan` when ready.
