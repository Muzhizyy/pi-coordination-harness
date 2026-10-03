import { createHash } from "node:crypto";
import { readFile, lstat, readlink } from "node:fs/promises";
import { join } from "node:path";
import { git, gitOk } from "../utils/exec.js";
import { normalizedRelative, realRelative, pathMatchesPattern } from "../sandbox/path-policy.js";

export async function readCandidateFile(workspace: string, file: string, denyRead: string[] = []): Promise<string> {
  if (!file || normalizedRelative(workspace, file) !== file || file.split("/").includes(".git") || pathMatchesPattern(file, denyRead) || await realRelative(workspace, file) !== file) throw new Error(`Unsafe evidence path: ${file}`);
  const stat = await lstat(join(workspace, file));
  if (!stat.isFile() || stat.size > 256 * 1024) throw new Error(`Evidence must be a bounded regular file: ${file}`);
  const data = await readFile(join(workspace, file));
  if (data.includes(0)) throw new Error(`Binary evidence is unsupported: ${file}`);
  return data.toString("utf8");
}

export async function changedFiles(workspace: string, base: string): Promise<string[]> {
  const results = await Promise.all([git(workspace, ["diff", "--name-only", "--no-renames", "-z", base]), git(workspace, ["ls-files", "--others", "--exclude-standard", "-z"])]);
  if (results.some((r) => r.exitCode !== 0)) throw new Error("Cannot inspect complete candidate state");
  return [...new Set(results.flatMap((r) => r.stdout.split("\0")).filter(Boolean))].sort();
}

/** Exact tracked/unignored state, including staged changes and deleted files. */
export async function candidateDigest(workspace: string): Promise<string> {
  const h = createHash("sha256");
  h.update(await gitOk(workspace, ["rev-parse", "HEAD"]));
  const diff = await git(workspace, ["diff", "--binary", "HEAD"]);
  if (diff.exitCode !== 0) throw new Error("Cannot fingerprint candidate");
  h.update(diff.stdout);
  const untracked = await git(workspace, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (untracked.exitCode !== 0) throw new Error("Cannot fingerprint untracked files");
  for (const file of untracked.stdout.split("\0").filter(Boolean).sort()) {
    h.update(JSON.stringify(file));
    const stat = await lstat(join(workspace, file));
    h.update(String(stat.mode));
    if (stat.isSymbolicLink()) { h.update(await readlink(join(workspace, file))); continue; }
    if (!stat.isFile()) { h.update("non-regular"); continue; }
    h.update(await readFile(join(workspace, file)));
  }
  return h.digest("hex");
}
