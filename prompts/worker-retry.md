Continue the SAME task in the SAME worker session. Do not restart repository understanding.

## TaskContract
{{TASK_CONTRACT}}

## New deterministic failure/evidence
{{FAILURE_EVIDENCE}}

Use this evidence to repair or reclassify the task. If it is a local implementation failure, fix it and retest. If it proves the contract/architecture is inconsistent, return `contract_conflict` with precise evidence. Finish by calling `submit_outcome`.
