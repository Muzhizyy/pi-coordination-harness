import { basename, extname } from "node:path";
import { gitOk } from "../utils/exec.js";

const MANIFEST_NAMES = new Set([
  "package.json", "pyproject.toml", "requirements.txt", "uv.lock", "poetry.lock",
  "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile",
  "composer.json", "Makefile", "CMakeLists.txt",
]);

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
  ".py": "Python", ".rs": "Rust", ".go": "Go", ".java": "Java", ".kt": "Kotlin",
  ".c": "C", ".h": "C/C++", ".cpp": "C++", ".cc": "C++", ".cs": "C#",
  ".rb": "Ruby", ".php": "PHP", ".swift": "Swift", ".scala": "Scala",
};

export async function assertGitRepository(repo: string): Promise<void> {
  const inside = await gitOk(repo, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") throw new Error(`${repo} is not a Git work tree`);
}

export async function repositoryHead(repo: string): Promise<string> {
  return gitOk(repo, ["rev-parse", "HEAD"]);
}

export async function trackedFiles(repo: string): Promise<string[]> {
  const out = await gitOk(repo, ["ls-tree", "-r", "--name-only", "-z", "HEAD"]);
  return out ? out.split("\0").filter(Boolean) : [];
}

export async function deterministicInventory(repo: string): Promise<{
  name: string;
  revision: string;
  files: string[];
  manifests: string[];
  languages: Record<string, number>;
  topLevelEntries: string[];
}> {
  const [revision, files] = await Promise.all([repositoryHead(repo), trackedFiles(repo)]);
  const languages: Record<string, number> = {};
  for (const file of files) {
    const lang = LANGUAGE_BY_EXT[extname(file).toLowerCase()];
    if (lang) languages[lang] = (languages[lang] ?? 0) + 1;
  }
  const manifests = files.filter((file) => MANIFEST_NAMES.has(basename(file)));
  const topLevelEntries = [...new Set(files.map((file) => file.split("/")[0]))].sort();
  return { name: basename(repo), revision, files, manifests, languages, topLevelEntries };
}
