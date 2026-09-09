import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizedRelative, pathMatchesPattern, pathMatchesScope, realRelative } from "../src/sandbox/path-policy.ts";

test("normalizedRelative rejects workspace escape", () => {
  assert.equal(normalizedRelative("/tmp/work", "src/a.ts"), "src/a.ts");
  assert.equal(normalizedRelative("/tmp/work", "../secret"), null);
});

test("realRelative rejects symlink escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "role-harness-policy-"));
  const workspace = join(root, "workspace");
  const outside = join(root, "outside");
  await mkdir(workspace);
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "secret");
  await symlink(outside, join(workspace, "link"));
  assert.equal(await realRelative(workspace, "link/secret.txt"), null);
  assert.equal(await realRelative(workspace, "new/file.txt"), "new/file.txt");
});

test("write scopes support prefixes and globstar", () => {
  assert.equal(pathMatchesScope("src/users/a.ts", ["src/users/**"]), true);
  assert.equal(pathMatchesScope("src/auth/a.ts", ["src/users/**"]), false);
  assert.equal(pathMatchesScope("tests/users/a.test.ts", ["tests/**"]), true);
});

test("sensitive filename patterns match workspace-relative paths", () => {
  assert.equal(pathMatchesPattern(".env", [".env", "*.pem"]), true);
  assert.equal(pathMatchesPattern("secrets/client.pem", ["*.pem"]), true);
  assert.equal(pathMatchesPattern("src/client.ts", ["*.pem"]), false);
});
