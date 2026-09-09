# Validation / 验证记录

Date: 2026-09-10 (Asia/Shanghai). Source snapshot prepared on Linux/WSL. JavaScript checks used Node 24.15.0; DSH used pnpm 11.7.0.
日期：2026-09-10，Asia/Shanghai。本次验证在 Linux/WSL 环境完成。

## Executed checks / 实际执行

- `npm install --no-audit --no-fund`: passed; generated `package-lock.json`.
- `npm run check`: passed; TypeScript checking, 11 tests, clean build.
- `node dist/cli.js --help`: passed without a model call.
- Tarball inventory: CLI/library declarations and runtime prompts included; sources, tests, state and personal config excluded.
- Unpacked-package CLI and prompt loading smoke checks: performed with the installed dependency tree linked into the extracted package; not a separate fresh dependency installation.

通过类型检查、11 个回归测试及干净构建。打包目录包含 CLI、库入口、声明和提示词，排除源码、测试及个人配置。解包冒烟检查复用已安装依赖，不宣称完成了一次全新依赖安装。

Fixes: align compiler output with package entrypoints; retain the trailing newline in exported patches; include staged/untracked/post-check files in scope verification; set commit identity for integration cherry-picks; reject unsafe task IDs and invalid dependency graphs; bound context retries and repeated strong-worker escalation; validate config types and budgets; correct Pi event narrowing and portable declaration types.
修复内容包括编译入口、补丁换行、暂存/新增/检查后文件的范围验收、集成提交身份、任务 ID 与依赖图校验、上下文重试及Pro 模型重复升级边界、配置类型与预算，以及 Pi SDK 类型兼容。

Not validated: authenticated Pi model calls, actual OS sandbox execution, provider availability, end-to-end completion of a live coding task, or cost/quality benchmarks. The initial code remains an experimental runtime.
未验证：真实 Pi 模型调用、操作系统沙箱实际执行、模型可用性、真实编码任务端到端完成，以及费用/质量基准。项目仍是实验性运行框架。

## Source hygiene / 源码清理

The source copy excludes dependency trees, build caches, original `.desktop-test` state, credentials and personal `.agent-orch` runs. Filename and common secret-pattern checks found no personal absolute paths or live credentials in the reviewed source set. DSH test canaries intentionally resemble credentials to exercise redaction; they were manually inspected and retained. This is a targeted preparation review, not a complete security audit.
源码副本排除了依赖、构建缓存、原始桌面测试状态、凭据及个人运行记录。对待提交文件进行路径和常见密钥模式检查，未发现个人绝对路径或真实凭据；DSH 中命中的脱敏测试假密钥经人工核对后保留。本次为开源整理检查，不是完整安全审计。

## Publication / 发布

GitHub CI has been configured but has not run on GitHub. No remote repository or package release is created by these local checks. See [publishing](PUBLISHING.md).
已配置 CI，尚未在 GitHub 执行。此次本地检查未创建远程仓库或发布包，后续步骤见发布指南。

## Branding update / 命名与展示更新

The package and CLI are now `flashpro-pi`; the default config is `flashpro.config.json`. Public configuration accepts `pro`, `flash`, and optional `proWorker`, mapped to the existing internal runtime fields. Previous config field names remain supported. Type checking, all 11 tests (including Pro / Flash configuration), clean build, CLI help, and package inventory checks passed.
包名和 CLI 改为 `flashpro-pi`，默认配置名改为 `flashpro.config.json`。公开配置使用 `pro`、`flash`、可选 `proWorker`，并兼容原字段。类型检查、11 个测试、构建、CLI 帮助与包清单检查通过。
