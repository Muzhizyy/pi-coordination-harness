import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withGlobstar = escaped.replace(/\*\*/g, "\u0000");
  const withStar = withGlobstar.replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp(`^${withStar}$`);
}

export function normalizedRelative(workspace: string, path: string): string | null {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(workspace, path);
  const rel = relative(resolve(workspace), absolute).split(sep).join("/");
  if (rel === "") return "";
  if (rel === ".." || rel.startsWith("../")) return null;
  return rel;
}

async function existingAncestor(path: string): Promise<{ ancestor: string; suffix: string[] }> {
  let cursor = path;
  const suffix: string[] = [];
  while (true) {
    try {
      await lstat(cursor);
      return { ancestor: cursor, suffix };
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) throw new Error(`No existing ancestor for ${path}`);
      suffix.unshift(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
      cursor = parent;
    }
  }
}

/**
 * Resolve symlinks in the workspace and the deepest existing ancestor of a candidate path.
 * This prevents a lexical in-workspace path such as `link/secret` from escaping through a symlink.
 */
export async function realRelative(workspace: string, path: string): Promise<string | null> {
  const lexical = normalizedRelative(workspace, path);
  if (lexical === null) return null;
  const workspaceReal = await realpath(workspace);
  const absolute = isAbsolute(path) ? resolve(path) : resolve(workspace, path);
  const { ancestor, suffix } = await existingAncestor(absolute);
  const ancestorReal = await realpath(ancestor);
  const resolvedCandidate = resolve(ancestorReal, ...suffix);
  const rel = relative(workspaceReal, resolvedCandidate).split(sep).join("/");
  if (rel === "") return "";
  if (rel === ".." || rel.startsWith("../")) return null;
  return rel;
}

export function pathMatchesScope(relativePath: string, scopes: string[]): boolean {
  const normalized = relativePath.replace(/^\.\//, "");
  return scopes.some((raw) => {
    const scope = raw.replace(/^\.\//, "").replace(/\\/g, "/");
    if (scope.endsWith("/**")) {
      const prefix = scope.slice(0, -3).replace(/\/$/, "");
      return normalized === prefix || normalized.startsWith(`${prefix}/`);
    }
    if (!scope.includes("*")) return normalized === scope || normalized.startsWith(`${scope.replace(/\/$/, "")}/`);
    return wildcardToRegex(scope).test(normalized);
  });
}

export function pathMatchesPattern(relativePath: string, patterns: string[]): boolean {
  const normalized = relativePath.replace(/^\.\//, "");
  const basename = normalized.split("/").at(-1) ?? normalized;
  return patterns.some((raw) => {
    const pattern = raw.replace(/^\.\//, "").replace(/\\/g, "/");
    // Absolute/home patterns are irrelevant once realRelative has confined the path to the workspace.
    if (pattern.startsWith("/") || pattern.startsWith("~/")) return false;
    if (!pattern.includes("/")) return wildcardToRegex(pattern).test(basename);
    return wildcardToRegex(pattern).test(normalized);
  });
}
