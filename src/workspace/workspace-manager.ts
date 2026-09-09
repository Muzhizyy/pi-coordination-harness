import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { rm } from "node:fs/promises";
import { git, gitOk } from "../utils/exec.js";
import { ensureDir } from "../utils/fs.js";

export class WorkspaceManager {
  private readonly root: string;
  private integrationPath?: string;

  constructor(private readonly repo: string, private readonly runId: string) {
    this.root = join(tmpdir(), "pi-coordination-harness", `${basename(repo)}-${runId}`);
  }

  async createIntegration(baseRevision: string): Promise<string> {
    await rm(this.root, { recursive: true, force: true });
    await gitOk(this.repo, ["worktree", "prune"]);
    await ensureDir(this.root);
    const path = join(this.root, "integration");
    await gitOk(this.repo, ["worktree", "add", "--detach", path, baseRevision]);
    this.integrationPath = path;
    return path;
  }

  async integrationHead(): Promise<string> {
    if (!this.integrationPath) throw new Error("Integration workspace not created");
    return gitOk(this.integrationPath, ["rev-parse", "HEAD"]);
  }

  async createTask(taskId: string): Promise<string> {
    if (!this.integrationPath) throw new Error("Integration workspace not created");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(taskId)) throw new Error("Invalid task id");
    const base = await this.integrationHead();
    const path = join(this.root, `task-${taskId}`);
    await gitOk(this.repo, ["worktree", "add", "--detach", path, base]);
    return path;
  }

  async acceptTask(taskPath: string, taskId: string): Promise<string> {
    if (!this.integrationPath) throw new Error("Integration workspace not created");
    await gitOk(taskPath, ["add", "-A"]);
    const status = await gitOk(taskPath, ["status", "--porcelain"]);
    if (!status) throw new Error(`Task ${taskId} produced no changes`);
    await gitOk(taskPath, ["-c", "user.name=Pi Coordination Harness", "-c", "user.email=role-harness@local", "commit", "-m", `role-harness: ${taskId}`]);
    const commit = await gitOk(taskPath, ["rev-parse", "HEAD"]);
    await gitOk(this.integrationPath, ["-c", "user.name=Pi Coordination Harness", "-c", "user.email=role-harness@local", "cherry-pick", commit]);
    return commit;
  }

  async removeTask(taskPath: string): Promise<void> {
    await gitOk(this.repo, ["worktree", "remove", "--force", taskPath]);
  }

  async finalPatch(baseRevision: string): Promise<string> {
    if (!this.integrationPath) throw new Error("Integration workspace not created");
    const result = await git(this.integrationPath, ["diff", "--binary", `${baseRevision}..HEAD`]);
    if (result.exitCode !== 0) throw new Error(`Cannot export patch: ${result.stderr}`);
    return result.stdout; // Preserve trailing newlines: git apply consumes exact patch bytes.
  }

  async dispose(): Promise<void> {
    if (this.integrationPath) {
      try { await gitOk(this.repo, ["worktree", "remove", "--force", this.integrationPath]); } catch {}
    }
    await rm(this.root, { recursive: true, force: true });
  }
}
