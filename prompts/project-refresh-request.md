Refresh the durable Project IR because the repository revision changed.

## Previous Architecture IR
{{ARCHITECTURE}}

## Previous Project index
{{PROJECT_INDEX}}

## Durable decisions
{{DECISIONS}}

## Revision change
Previous revision: {{PREVIOUS_REVISION}}
Current revision: {{CURRENT_REVISION}}

## Changed tracked files
{{CHANGED_FILES}}

## Current deterministic inventory
{{INVENTORY}}

Update only the architectural facts affected by this change. Preserve still-valid module responsibilities, interfaces, capabilities and constraints. Use targeted read/grep/find/ls when the changed files or their direct dependents can alter the project-level model. Do not turn implementation churn into architecture churn.

Every changed durable claim should remain evidence-backed. Keep uncertainty explicit. Call `commit_project_ir` exactly once with the complete refreshed IR.
