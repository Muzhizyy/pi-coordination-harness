import type { HarnessConfig, ObligationResult, TaskContract, VerificationObligation, VerificationResult } from "../types.js";
import { pathMatchesScope } from "../sandbox/path-policy.js";
import { SandboxController } from "../sandbox/sandbox-controller.js";
import { gitOk } from "../utils/exec.js";
import { candidateDigest, changedFiles, readCandidateFile } from "./source-snapshot.js";
import { validateTaskObligations, validateObligations } from "./obligations.js";
import type { SemanticReviewer } from "./semantic-reviewer.js";

export class Verifier {
  constructor(private readonly config: HarnessConfig, private readonly reviewer?: SemanticReviewer) {}

  private async evaluate(workspace: string, obligations: VerificationObligation[], commandsToRun: string[],
    run: (command: string) => Promise<{ exitCode: number; output: string }>): Promise<VerificationResult> {
    const before = await candidateDigest(workspace);
    const failures: string[] = [];
    const commands: VerificationResult["commands"] = [];
    const results: ObligationResult[] = [];
    for (const command of [...new Set([...commandsToRun, ...obligations.flatMap((o) => o.check.kind === "command" ? [o.check.command] : [])])]) {
      const result = await run(command);
      commands.push({ command, ...result, output: result.output.slice(-16000) });
      if (result.exitCode !== 0 && commandsToRun.includes(command)) failures.push(`Verification failed: ${command}\n${result.output.slice(-8000)}`);
    }
    for (const o of obligations) {
      if (o.check.kind === "command") {
        const result = commands.find((c) => c.command === (o.check.kind === "command" ? o.check.command : ""))!;
        results.push({ id: o.id, requirementId: o.requirementId, status: result.exitCode === 0 ? "verified" : "violated", summary: `exit=${result.exitCode}`, evidence: [{ id: `check:${o.id}`, kind: "command", locator: result.command, summary: result.output.slice(-2000), revision: `candidate:${before}` }] });
      } else if (o.check.kind === "source") {
        try {
          const source = await readCandidateFile(workspace, o.check.file, this.config.sandbox?.denyRead);
          const ok = o.check.contains.every((s) => source.includes(s)) && o.check.notContains.every((s) => !source.includes(s));
          results.push({ id: o.id, requirementId: o.requirementId, status: ok ? "verified" : "violated", summary: ok ? "Source assertions hold" : "Source assertion mismatch", evidence: [{ id: `assert:${o.id}`, kind: "source", locator: o.check.file, summary: o.description, revision: `candidate:${before}` }] });
        } catch (error) { results.push({ id: o.id, requirementId: o.requirementId, status: "unverified", summary: String(error), evidence: [] }); }
      }
    }
    if (obligations.some((o) => o.check.kind === "review")) {
      if (this.reviewer) results.push(...await this.reviewer.obligations(workspace, before, obligations));
      else results.push(...obligations.filter((o) => o.check.kind === "review").map((o): ObligationResult => ({ id: o.id, requirementId: o.requirementId, status: "unverified", summary: "Independent reviewer unavailable", evidence: [] })));
    }
    const after = await candidateDigest(workspace);
    if (before !== after) {
      failures.push("Verification modified tracked source or unignored files; evidence no longer matches the candidate");
      for (const result of results) { result.status = "unverified"; result.summary = "Candidate changed during verification"; }
    }
    for (const o of obligations.filter((o) => o.mandatory)) {
      const r = results.find((r) => r.id === o.id);
      if (!r || r.status !== "verified") failures.push(`Mandatory obligation ${o.id}: ${r?.status ?? "unverified"} (${r?.summary ?? "no evidence"})`);
    }
    return { ok: !failures.length, changedFiles: [], commands, failures, obligations: results, candidateDigest: after };
  }

  async verifyTask(workspace: string, contract: TaskContract,
    execCommand?: (command: string) => Promise<{ exitCode: number; output: string }>): Promise<VerificationResult> {
    validateTaskObligations(contract);
    if (await gitOk(workspace, ["rev-parse", "HEAD"]) !== contract.baseRevision) throw new Error("Worker moved HEAD outside the task contract");
    const result = await this.evaluate(workspace, contract.obligations, ["git diff --check HEAD && git diff --cached --check", ...contract.verificationCommands], execCommand ?? ((command) => this.execInSandbox(workspace, command)));
    result.taskId = contract.id;
    result.changedFiles = await changedFiles(workspace, contract.baseRevision);
    for (const file of result.changedFiles) if (!pathMatchesScope(file, contract.writeScopes)) result.failures.push(`Write-scope violation: ${file}`);
    if (!result.changedFiles.length) result.failures.push("No changed files");
    result.ok = !result.failures.length;
    return result;
  }

  async verifyFinal(workspace: string, commandsToRun: string[], obligations: VerificationObligation[] = []): Promise<VerificationResult> {
    if (obligations.length) validateObligations(obligations);
    const result = await this.evaluate(workspace, obligations, commandsToRun, (command) => this.execInSandbox(workspace, command));
    if (!obligations.length && !commandsToRun.length) { result.failures.push("Project verification needs obligations or commands"); result.ok = false; }
    if ((await changedFiles(workspace, "HEAD")).length) {
      result.failures.push("Final verification left changes outside the committed patch (tracked source or unignored files)");
      result.ok = false;
    }
    return result;
  }

  private async execInSandbox(workspace: string, command: string): Promise<{ exitCode: number; output: string }> {
    const sandbox = new SandboxController();
    await sandbox.initialize(workspace, this.config.sandbox);
    try { return await sandbox.exec(command, workspace); }
    finally { await sandbox.dispose(); }
  }
}
