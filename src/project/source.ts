import { git, gitOk } from "../utils/exec.js";

/** Read committed blobs, never a dirty checkout or an arbitrary host file. */
export async function readRevisionFile(repo: string, revision: string, file: string): Promise<string> {
  if (!/^[a-f0-9]{40,64}$/.test(revision)) throw new Error("Expected a full Git commit id");
  if (!file || file.startsWith("/") || file.split("/").some((p) => p === ".." || p === ".git") || file.includes("\0")) {
    throw new Error("Invalid evidence path");
  }
  const object = `${revision}:${file}`;
  if (await gitOk(repo, ["cat-file", "-t", object]) !== "blob") throw new Error("Evidence path is not a file");
  if (Number(await gitOk(repo, ["cat-file", "-s", object])) > 262_144) throw new Error("Evidence file exceeds 256 KiB limit");
  const result = await git(repo, ["show", object]);
  if (result.exitCode !== 0) throw new Error(`Evidence file unavailable: ${file}`);
  if (result.stdout.includes("\0")) throw new Error("Binary source evidence is not supported");
  return result.stdout;
}
