import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("package includes the root policy and license without duplicate skill discovery or a vendor directory", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.private, true);
  assert.deepEqual(pkg.pi.skills, []);
  assert.equal(pkg.pi.extensions.length, 1);
  const extension = await import(new URL(pkg.pi.extensions[0], root));
  assert.equal(typeof extension.default, "function");

  for (const path of ["index.ts", "SKILL.md", "LICENSE"]) {
    assert.ok(pkg.files.includes(path), `${path} must be packaged`);
    assert.ok((await read(path)).length > 0);
  }
  assert.match(await read("SKILL.md"), /^---\nname: caveman\n/);
  assert.match(await read("LICENSE"), /MIT License/);
  assert.match(await read("LICENSE"), /Copyright \(c\) 2026 Julius Brussee/);
  assert.match(await read("LICENSE"), /5184b3d11ac6a1acb7d44b9bfaa31698157cff97/);
  assert.ok(!pkg.files.some((path) => path.startsWith("vendor")));
  await assert.rejects(access(new URL("vendor", root)), { code: "ENOENT" });
});
