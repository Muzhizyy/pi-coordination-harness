Implement exactly this bounded task.

## TaskContract
{{TASK_CONTRACT}}

## Role-specific Project IR slice
{{PROJECT_CONTEXT}}

The filesystem is an isolated task workspace. Use read/grep/find/ls/edit/write/bash as needed. The runtime will independently check the diff, write scopes and verification commands.

When you have either a candidate patch or a precise blocker, call `submit_outcome` exactly once.
