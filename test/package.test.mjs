import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("package includes extensions and their policy without duplicate skill discovery or legacy directories", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.private, true);
  assert.deepEqual(pkg.pi.skills, []);
  assert.deepEqual(pkg.pi.extensions, ["./extensions/index.ts", "./extensions/speech/index.ts"]);
  for (const path of pkg.pi.extensions) {
    const extension = await import(new URL(path, root));
    assert.equal(typeof extension.default, "function");
  }
  assert.ok(pkg.files.includes("extensions/speech/*.ts"));
  for (const path of ["index.ts", "player.ts", "audio.ts", "text.ts"]) {
    assert.ok((await read(`extensions/speech/${path}`)).length > 0);
  }
  assert.equal(pkg.scripts["setup:speech"], "sh extensions/speech/setup.sh");

  for (const path of ["extensions/index.ts", "extensions/SKILL.md", "extensions/speech/worker.py", "extensions/speech/setup.sh", "extensions/speech/requirements.txt", "LICENSE"]) {
    assert.ok(pkg.files.includes(path), `${path} must be packaged`);
    assert.ok((await read(path)).length > 0);
  }
  assert.match(await read("extensions/SKILL.md"), /^---\nname: caveman\n/);
  assert.match(await read("LICENSE"), /MIT License/);
  assert.match(await read("LICENSE"), /Copyright \(c\) 2026 Julius Brussee/);
  assert.match(await read("LICENSE"), /5184b3d11ac6a1acb7d44b9bfaa31698157cff97/);
  assert.ok(!pkg.files.some((path) => path.startsWith("vendor")));
  for (const path of ["vendor", "index.ts", "SKILL.md", "speech"]) {
    await assert.rejects(access(new URL(path, root)), { code: "ENOENT" });
  }
});
