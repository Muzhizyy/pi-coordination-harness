import type { HarnessConfig, TaskContract, VerificationResult } from "../types.js";
import { git } from "../utils/exec.js";
import { pathMatchesScope } from "../sandbox/path-policy.js";
import { SandboxController } from "../sandbox/sandbox-controller.js";

export class Verifier {
  constructor(private readonly config: HarnessConfig) {}

  async verifyTask(
    workspace: string,
    contract: TaskContract,
    execCommand?: (command: string) => Promise<{ exitCode: number; output: string }>,
  ): Promise<VerificationResult> {
    const failures: string[] = [];
    const commands: VerificationResult["commands"] = [];
    const run = execCommand ?? ((command: string) => this.execInSandbox(workspace, command));
    const diffCheck = await run("git diff --check HEAD && git diff --cached --check");
    commands.push({ command: "git diff --check", ...diffCheck });
    if (diffCheck.exitCode !== 0) failures.push(`git diff --check failed: ${diffCheck.output}`);
    for (const command of contract.verificationCommands) {
      const result = await run(command);
      commands.push({ command, ...result });
      if (result.exitCode !== 0) failures.push(`Verification failed: ${command}\n${result.output}`);
    }
    // Inspect the final candidate, including staged edits and new files created by checks.
    const trackedResult = await git(workspace, ["diff", "--name-only", "--no-renames", "-z", contract.baseRevision]);
    const untrackedResult = await git(workspace, ["ls-files", "--others", "--exclude-standard", "-z"]);
    if (trackedResult.exitCode !== 0 || untrackedResult.exitCode !== 0) {
      throw new Error("Cannot inspect the complete candidate diff");
    }
    const changedFiles = [...new Set([...trackedResult.stdout.split("\0"), ...untrackedResult.stdout.split("\0")].filter(Boolean))];
    for (const file of changedFiles) {
      if (!pathMatchesScope(file, contract.writeScopes)) failures.push(`Write-scope violation: ${file}`);
    }
    return { ok: failures.length === 0 && changedFiles.length > 0, taskId: contract.id, changedFiles, commands, failures: changedFiles.length ? failures : [...failures, "No changed files"] };
  }

  async verifyFinal(workspace: string, commandsToRun: string[]): Promise<VerificationResult> {
    const commands: VerificationResult["commands"] = [];
    const failures: string[] = [];
    for (const command of commandsToRun) {
      const result = await this.execInSandbox(workspace, command);
      commands.push({ command, ...result });
      if (result.exitCode !== 0) failures.push(`Final verification failed: ${command}\n${result.output}`);
    }
    return { ok: failures.length === 0, changedFiles: [], commands, failures };
  }

  private async execInSandbox(workspace: string, command: string): Promise<{ exitCode: number; output: string }> {
    const sandbox = new SandboxController();
    await sandbox.initialize(workspace, this.config.sandbox);
    try { return await sandbox.exec(command, workspace); }
    finally { await sandbox.dispose(); }
  }
}
