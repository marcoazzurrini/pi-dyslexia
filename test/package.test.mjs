import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("package exposes a loadable extension and bundles Caveman without duplicate skill discovery", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.private, true);
  assert.deepEqual(pkg.pi.skills, []);
  assert.equal(pkg.pi.extensions.length, 1);
  const extension = await import(new URL(pkg.pi.extensions[0], root));
  assert.equal(typeof extension.default, "function");

  const upstream = JSON.parse(await read("vendor/caveman/upstream.json"));
  assert.match(upstream.commit, /^[a-f0-9]{40}$/);
  assert.equal(upstream.files["SKILL.md"], "skills/caveman/SKILL.md");
  for (const path of ["SKILL.md", "LICENSE", "LICENSING.md"]) {
    assert.ok((await read(`vendor/caveman/${path}`)).length > 0);
  }
  assert.match(await read("vendor/caveman/SKILL.md"), /^---\nname: caveman\n/);
  assert.match(await read("vendor/caveman/LICENSE"), /MIT License/);
});
