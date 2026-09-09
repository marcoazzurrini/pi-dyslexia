import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import dyslexia from "../extensions/index.ts";
import { noop } from "./helpers.mjs";

test("adapted policy starts on, toggles between runs, and resets on every session load", async () => {
  const handlers = new Map();
  const commands = new Map();
  const statuses = [];
  const notifications = [];
  const ctx = {
    hasUI: true,
    ui: {
      notify: (...args) => notifications.push(args),
      setStatus: (...args) => statuses.push(args),
    },
  };
  const api = {
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
  };
  await dyslexia(api);
  assert.deepEqual(
    [...handlers.keys()],
    ["session_start", "before_agent_start"]
  );
  assert.deepEqual([...commands.keys()], ["dyslexia"]);

  const event = Object.freeze({ systemPrompt: "Existing instructions." });
  const prompt = () =>
    handlers.get("before_agent_start")(event, ctx).systemPrompt;
  const command = (args) => commands.get("dyslexia").handler(args, ctx);
  const skill = await readFile(
    new URL("../extensions/SKILL.md", import.meta.url),
    "utf-8"
  );
  const body = skill.slice(skill.indexOf("\n---\n") + 5).trim();

  const initial = prompt();
  assert.ok(initial.startsWith(`${event.systemPrompt}\n\n${body}`));
  assert.match(initial, /pi-dyslexia is ON\. Apply the writing policy above/u);
  assert.match(initial, /\/dyslexia on\|off\|status/u);
  assert.doesNotMatch(
    initial.slice(initial.indexOf("## pi-dyslexia state")),
    /caveman/iu
  );
  assert.doesNotMatch(commands.get("dyslexia").description, /caveman/iu);
  assert.match(
    initial,
    /Keep main conclusions, key evidence\/citations, conditions, uncertainty, and warnings/u
  );
  assert.match(initial, /Never truncate code or requested documents/u);
  assert.match(initial, /Preserve meaningful uncertainty/u);
  assert.match(initial, /ASD-STE100 Simplified Technical English/u);
  assert.match(initial, /Never drop not\/never\/no\/only\/except/u);
  assert.match(
    initial,
    /Coverage: minimize words without silently dropping requested scope/u
  );
  assert.doesNotMatch(
    initial,
    /## Intensity|Selected intensity:|wenyan|vendor\//u
  );
  assert.ok(!initial.includes("name: caveman"));
  assert.equal(prompt(), initial, "injection does not accumulate between runs");
  assert.equal(event.systemPrompt, "Existing instructions.");

  await handlers.get("session_start")({ reason: "startup" }, ctx);
  assert.deepEqual(statuses.at(-1), ["dyslexia", "dyslexia: on"]);
  await command("  OFF  ");
  assert.match(prompt(), /pi-dyslexia is OFF/u);
  assert.doesNotMatch(prompt(), /caveman/iu);
  assert.ok(!prompt().includes(body));
  assert.deepEqual(statuses.at(-1), ["dyslexia", "dyslexia: off"]);
  for await (const args of ["", "status", "  STATUS  "]) {
    await command(args);
    assert.deepEqual(notifications.at(-1), ["pi-dyslexia off.", "info"]);
    assert.match(prompt(), /pi-dyslexia is OFF/u);
  }
  for await (const args of [
    "off extra",
    "caveman",
    "caveman on",
    "caveman off",
    "caveman status",
  ]) {
    await command(args);
    assert.deepEqual(notifications.at(-1), [
      "Usage: /dyslexia on|off|status",
      "error",
    ]);
    assert.match(
      prompt(),
      /pi-dyslexia is OFF/u,
      "invalid commands leave state unchanged"
    );
  }
  await command("on");
  assert.equal(prompt(), initial);
  assert.deepEqual(statuses.at(-1), ["dyslexia", "dyslexia: on"]);
  assert.deepEqual(notifications.at(-1), ["pi-dyslexia on.", "info"]);
  for await (const args of ["", "status"]) {
    await command(args);
    assert.equal(prompt(), initial, "status queries do not toggle the policy");
    assert.deepEqual(notifications.at(-1), ["pi-dyslexia on.", "info"]);
  }

  for await (const reason of ["startup", "reload", "new", "resume", "fork"]) {
    await command("off");
    await handlers.get("session_start")({ reason }, ctx);
    assert.equal(prompt(), initial, reason);
  }

  // UI must never be accessed in print/JSON mode.
  const headless = { hasUI: false };
  await handlers.get("session_start")({ reason: "startup" }, headless);
  await commands.get("dyslexia").handler("off", headless);
  await commands.get("dyslexia").handler("invalid", headless);
  assert.match(prompt(), /pi-dyslexia is OFF/u);

  // A new extension instance must not remember the previous instance's off state.
  await dyslexia(api);
  assert.equal(prompt(), initial);
});

test("missing or malformed extension policy fails loading instead of silently injecting bad text", async () => {
  const dir = await mkdtemp(nodePath.join(tmpdir(), "pi-dyslexia-test-"));
  try {
    await copyFile(
      new URL("../extensions/index.ts", import.meta.url),
      nodePath.join(dir, "index.ts")
    );
    const { default: load } = await import(
      pathToFileURL(nodePath.join(dir, "index.ts"))
    );
    await assert.rejects(load({}), { code: "ENOENT" });
    for await (const content of [
      "no frontmatter",
      "---\nname: caveman\n---\n  ",
    ]) {
      await writeFile(nodePath.join(dir, "SKILL.md"), content);
      await assert.rejects(load({}), /Invalid SKILL\.md/u);
    }
    await writeFile(
      nodePath.join(dir, "SKILL.md"),
      "---\r\nname: caveman\r\n---\r\nRoot policy.\r\n"
    );
    const handlers = new Map();
    await load({
      on: (name, handler) => handlers.set(name, handler),
      registerCommand: noop,
    });
    const result = handlers.get("before_agent_start")({
      systemPrompt: "Base.",
    });
    assert.ok(result.systemPrompt.startsWith("Base.\n\nRoot policy.\n\n"));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
