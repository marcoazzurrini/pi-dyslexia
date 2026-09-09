import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { noop } from "./helpers.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf-8");

test("package includes extensions and their policy without duplicate skill discovery or legacy directories", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.private, true);
  assert.deepEqual(pkg.pi.skills, []);
  assert.deepEqual(pkg.pi.extensions, [
    "./extensions/index.ts",
    "./extensions/speech/index.ts",
  ]);
  for await (const path of pkg.pi.extensions) {
    const extension = await import(new URL(path, root));
    const commands = [];
    await extension.default({
      on: noop,
      registerCommand: (name) => commands.push(name),
      registerShortcut: noop,
    });
    assert.deepEqual(commands, [
      path.includes("/speech/") ? "speech" : "dyslexia",
    ]);
  }
  assert.ok(pkg.files.includes("extensions/speech/*.ts"));
  for await (const path of [
    "index.ts",
    "player.ts",
    "audio.ts",
    "async.ts",
    "text.ts",
  ]) {
    const contents = await read(`extensions/speech/${path}`);
    assert.ok(contents.length > 0);
  }
  assert.equal(pkg.scripts["setup:speech"], "sh extensions/speech/setup.sh");

  for await (const path of [
    "extensions/index.ts",
    "extensions/SKILL.md",
    "extensions/speech/worker.py",
    "extensions/speech/setup.sh",
    "extensions/speech/requirements.txt",
    "LICENSE",
  ]) {
    assert.ok(pkg.files.includes(path), `${path} must be packaged`);
    const contents = await read(path);
    assert.ok(contents.length > 0);
  }
  assert.match(await read("extensions/SKILL.md"), /^---\nname: caveman\n/u);
  assert.match(await read("LICENSE"), /MIT License/u);
  assert.match(await read("LICENSE"), /Copyright \(c\) 2026 Julius Brussee/u);
  assert.match(
    await read("LICENSE"),
    /5184b3d11ac6a1acb7d44b9bfaa31698157cff97/u
  );
  assert.ok(!pkg.files.some((path) => path.startsWith("vendor")));
  for await (const path of ["vendor", "index.ts", "SKILL.md", "speech"]) {
    await assert.rejects(access(new URL(path, root)), { code: "ENOENT" });
  }
});
