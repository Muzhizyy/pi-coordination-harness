Build the initial Project IR for this repository.

## Deterministic inventory
{{INVENTORY}}

Inspect only what is necessary to answer:
1. What are the major modules/domains and their responsibilities?
2. Which interfaces/CLI/API/SDK surfaces are compatibility-sensitive?
3. Which reusable capabilities should future workers reuse instead of reimplementing?
4. Which architecture or testing constraints matter across tasks?
5. Which facts remain uncertain?

Use read/grep/find/ls for targeted evidence. Then call `commit_project_ir`.
