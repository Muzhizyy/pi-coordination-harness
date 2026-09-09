# Pi Role Harness

[English](README.md) | 简体中文

基于 Pi 的**大小模型分工协作框架**：强模型负责项目级规划，快速模型负责局部实现，通过确定性验收生成可审阅补丁。

**状态：实验性 0.1.0 · MIT · 运行环境为 Linux/macOS。** 真实模型端到端运行尚未完成认证。Windows 用户请在 WSL2 内使用 Linux 版 Node 和 Git。本项目独立于 Pi 官方项目。

## 工作方式

需求与持久化 Project IR → 强规划模型 → 任务契约 → 快速执行模型 → 范围检查与测试 → 集成工作区 → 最终验证与补丁。

Project IR 保存架构、接口、约束和证据，供多个需求复用。规划者只在需要项目级决策时运行；执行者保持任务局部会话，完成编辑、测试和调试。角色通过契约、执行结果和计划变更交接，而非转发完整对话。局部能力不足可升级强执行模型，契约冲突才返回规划者。当前版本按顺序执行任务。

## 环境要求

- Node **22.19+**、npm、Git 和 bash。
- Pi SDK 基线为 `@earendil-works/pi-coding-agent` **0.85.1**，依赖版本通过 lockfile 固定。
- 已配置 Pi 模型认证，并选择本机 Pi 能识别的供应商和模型 ID。
- Linux 沙箱需要 `bubblewrap`、`socat`、`ripgrep`；macOS 使用受支持的沙箱后端。启用沙箱时，初始化必须成功。
- 目标必须是至少有一次提交的 Git 仓库。工作区基于已提交的 `HEAD`，不会复制未提交修改。

## 源码安装

```sh
npm ci
npm run check
cp role-harness.config.example.json role-harness.config.json
```

修改配置中的 `planner` 和 `worker` 为自己可用的模型；`strongWorker` 可选。示例模型 ID 仅供参考，不代表账号一定能访问。将 `verification.finalCommands` 设置为目标项目实际使用的测试、构建命令。空数组不会额外添加用户指定的最终检查，只运行计划提供的命令。

认证信息放在 Pi 凭据存储或供应商环境变量中，不要写入此仓库。真实运行会向模型发送选取的项目上下文，并可能产生供应商费用。

## 运行与应用补丁

在本框架仓库目录执行：

```sh
node dist/cli.js run \
  --repo /path/to/target-repository \
  --config ./role-harness.config.json \
  --requirement "增加分页并保持现有命令行兼容"
```

长需求可改用 `--requirement-file /path/to/request.md`。帮助命令为 `node dist/cli.js --help`；如需全局命令，可在本地运行 `npm link` 后使用 `pi-role-harness run ...`。

候选修改发生在临时 Git worktree 中，目标仓库的 `.agent-orch/` 保存状态、任务、结果和最终补丁。使用返回的真实运行 ID 替换 `<run-id>`，先审阅再应用：

```sh
git apply --check .agent-orch/runs/<run-id>/final.patch
git apply .agent-orch/runs/<run-id>/final.patch
```

应用补丁是用户主动执行的步骤。若任务与上下文不适合公开，应在目标项目中忽略 `.agent-orch/`。

## 验收和隔离

验收包括已跟踪、已暂存及新增文件，并在验证命令完成后重新检查写入范围。Git worktree 隔离候选修改；Pi 文件工具检查路径；启用沙箱时 bash 由 `@anthropic-ai/sandbox-runtime` 约束。关闭沙箱会移除操作系统隔离层。

worktree 本身不是安全边界。规划者的读取工具和模型通信不受执行者 shell 沙箱隔离。本框架尚不能作为处理恶意仓库的强化安全边界。验证命令应符合项目实际情况，临时 worktree 中可能需要额外安装依赖；被忽略的依赖目录不会从原工作区复制。

## 开发与限制

```sh
npm run check
npm pack --dry-run
```

源码位于 `src/`，运行时提示词位于 `prompts/`，确定性测试位于 `test/`。打包必须包含提示词。详见 [架构文档](docs/ARCHITECTURE.md)、[提示词设计](docs/PROMPT_DESIGN.md)、[验证记录](docs/VALIDATION.md) 和 [贡献指南](CONTRIBUTING.md)。

当前限制：顺序执行；文件级 IR 刷新；重新规划不支持回滚已接受任务；重试次数有界，但尚无供应商 token/费用上限；没有 UI。Skill 使用 snake_case，运行框架使用 camelCase，二者产物格式不直接兼容。不宣称未经测量的性能或费用收益。参考项目见 [资料来源](docs/REFERENCES.md)，采用 [MIT 许可证](LICENSE)。
