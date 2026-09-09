import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import dyslexia from "../extensions/index.ts";
import { extensionHarness, last, testContext } from "./helpers.ts";
import type { Notices, Statuses } from "./helpers.ts";

test("adapted policy starts on, toggles between runs, and resets on every session load", async () => {
  const { api, handlers, commands } = extensionHarness();
  const statuses: Statuses = [];
  const notifications: Notices = [];
  const ctx = testContext({
    hasUI: true,
    ui: {
      notify: (...args) => notifications.push(args),
      setStatus: (...args) => statuses.push(args),
    },
  });
  await dyslexia(api);
  assert.deepEqual(
    [...handlers.keys()],
    ["session_start", "before_agent_start"]
  );
  assert.deepEqual([...commands.keys()], ["dyslexia"]);

  const event = Object.freeze({ systemPrompt: "Existing instructions." });
  const prompt = async () => {
    const result = await handlers.get("before_agent_start")(event, ctx);
    assert.ok(result?.systemPrompt);
    return result.systemPrompt;
  };
  const command = (args: string) => commands.get("dyslexia").handler(args, ctx);
  const skill = await readFile(
    new URL("../extensions/SKILL.md", import.meta.url),
    "utf-8"
  );
  const body = skill.slice(skill.indexOf("\n---\n") + 5).trim();

  const initial = await prompt();
  assert.ok(initial.startsWith(`${event.systemPrompt}\n\n${body}`));
  assert.match(initial, /pi-dyslexia is ON\. Apply the writing policy above/u);
  assert.match(initial, /\/dyslexia on\|off\|status/u);
  assert.doesNotMatch(
    initial.slice(initial.indexOf("## pi-dyslexia state")),
    /caveman/iu
  );
  const { description } = commands.get("dyslexia");
  assert.ok(description);
  assert.doesNotMatch(description, /caveman/iu);
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
  assert.equal(
    await prompt(),
    initial,
    "injection does not accumulate between runs"
  );
  assert.equal(event.systemPrompt, "Existing instructions.");

  await handlers.get("session_start")({ reason: "startup" }, ctx);
  assert.deepEqual(last(statuses), ["dyslexia", "dyslexia: on"]);
  await command("  OFF  ");
  const disabled = await prompt();
  assert.match(disabled, /pi-dyslexia is OFF/u);
  assert.doesNotMatch(disabled, /caveman/iu);
  assert.ok(!disabled.includes(body));
  assert.deepEqual(last(statuses), ["dyslexia", "dyslexia: off"]);
  for await (const args of ["", "status", "  STATUS  "]) {
    await command(args);
    assert.deepEqual(last(notifications), ["pi-dyslexia off.", "info"]);
    assert.match(await prompt(), /pi-dyslexia is OFF/u);
  }
  for await (const args of [
    "off extra",
    "caveman",
    "caveman on",
    "caveman off",
    "caveman status",
  ]) {
    await command(args);
    assert.deepEqual(last(notifications), [
      "Usage: /dyslexia on|off|status",
      "error",
    ]);
    assert.match(
      await prompt(),
      /pi-dyslexia is OFF/u,
      "invalid commands leave state unchanged"
    );
  }
  await command("on");
  assert.equal(await prompt(), initial);
  assert.deepEqual(last(statuses), ["dyslexia", "dyslexia: on"]);
  assert.deepEqual(last(notifications), ["pi-dyslexia on.", "info"]);
  for await (const args of ["", "status"]) {
    await command(args);
    assert.equal(
      await prompt(),
      initial,
      "status queries do not toggle the policy"
    );
    assert.deepEqual(last(notifications), ["pi-dyslexia on.", "info"]);
  }

  for await (const reason of [
    "startup",
    "reload",
    "new",
    "resume",
    "fork",
  ] as const) {
    await command("off");
    await handlers.get("session_start")({ reason }, ctx);
    assert.equal(await prompt(), initial, reason);
  }

  // UI must never be accessed in print/JSON mode.
  const headless = testContext({ hasUI: false });
  await handlers.get("session_start")({ reason: "startup" }, headless);
  await commands.get("dyslexia").handler("off", headless);
  await commands.get("dyslexia").handler("invalid", headless);
  assert.match(await prompt(), /pi-dyslexia is OFF/u);

  // A new extension instance must not remember the previous instance's off state.
  await dyslexia(api);
  assert.equal(await prompt(), initial);
});

test("missing or malformed extension policy fails loading instead of silently injecting bad text", async () => {
  const dir = await mkdtemp(nodePath.join(tmpdir(), "pi-dyslexia-test-"));
  try {
    await copyFile(
      new URL("../extensions/index.ts", import.meta.url),
      nodePath.join(dir, "index.ts")
    );
    const { default: load }: { default: typeof dyslexia } = await import(
      pathToFileURL(nodePath.join(dir, "index.ts")).href
    );
    const { api, handlers } = extensionHarness();
    await assert.rejects(load(api), { code: "ENOENT" });
    for await (const content of [
      "no frontmatter",
      "---\nname: caveman\n---\n  ",
    ]) {
      await writeFile(nodePath.join(dir, "SKILL.md"), content);
      await assert.rejects(load(api), /Invalid SKILL\.md/u);
    }
    await writeFile(
      nodePath.join(dir, "SKILL.md"),
      "---\r\nname: caveman\r\n---\r\nRoot policy.\r\n"
    );
    await load(api);
    const result = await handlers.get("before_agent_start")(
      { systemPrompt: "Base." },
      testContext({})
    );
    assert.ok(result?.systemPrompt?.startsWith("Base.\n\nRoot policy.\n\n"));
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
