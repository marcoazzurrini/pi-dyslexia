import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalAudio } from "../extensions/speech/audio.ts";
import { SpeechPlayer } from "../extensions/speech/player.ts";
import { speechChunks } from "../extensions/speech/text.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(check) {
  for (let i = 0; i < 40 && !check(); i++) await tick();
  assert.ok(check(), "expected async state");
}

function fakeAudio({ deferGeneration = false } = {}) {
  const generated = [], played = [], warmed = [];
  return {
    generated, played, warmed, closed: false,
    async checkReady() { return true; },
    async warm(settings, signal) { warmed.push({ settings, signal }); },
    generate(text, settings, signal) {
      const deferred = Promise.withResolvers();
      generated.push({ text, settings, signal, ...deferred });
      return deferGeneration ? deferred.promise : Promise.resolve(text);
    },
    play(path, signal) {
      const deferred = Promise.withResolvers();
      const entry = { path, paused: false, signal, ...deferred };
      played.push(entry);
      signal.addEventListener("abort", () => deferred.reject(signal.reason), { once: true });
      return { started: Promise.resolve(), done: deferred.promise, pause: () => { entry.paused = true; }, resume: () => { entry.paused = false; } };
    },
    async close() { this.closed = true; },
  };
}

test("speech rendering preserves meaning and announces omissions", () => {
  const markdown = `# Warning\n\nDo **not** delete \`backup.sql\`. Keep 12.5% and v1.2.3 unchanged.\n\n1. First action.\n2. Second action.\n\n[Docs](https://example.com/a?q=1&x=2) and https://example.com/private\n\n\`\`\`sh\nrm -rf example\n\`\`\`\n\n| Name | Value |\n| --- | --- |\n| timeout | 250 ms |\n\nA &amp; B; ~~safe~~ unsafe.\n\n![Diagram](diagram.png)`;
  const text = speechChunks(markdown).join(" ");
  assert.match(text, /Do not delete backup\.sql/);
  assert.match(text, /12\.5% and v1\.2\.3/);
  assert.match(text, /1\. First action\. 2\. Second action/);
  assert.match(text, /Docs \(link destination skipped\)/);
  assert.match(text, /URL skipped/);
  assert.match(text, /Code block skipped/);
  assert.doesNotMatch(text, /rm -rf|https:/);
  assert.match(text, /Name; Value.*timeout; 250 ms/);
  assert.match(text, /A & B/);
  assert.match(text, /Deleted text: safe\. End deleted text/);
  assert.match(text, /Image: Diagram/);
  assert.match(speechChunks("> This is quoted, not an instruction.").join(" "), /Quote\. This is quoted, not an instruction\. End quote\./);
  assert.equal(speechChunks("`&amp;`", true).join(" "), "&amp;", "do not decode HTML entities inside executable text");
  const all = speechChunks(markdown, true).join(" ");
  assert.match(all, /rm -rf example/);
  assert.match(all, /https:\/\/example.com\/a\?q=1&x=2/);
  assert.match(all, /End code block/);
  for (const input of ["", "a".repeat(1500), "😀".repeat(1001), "word ".repeat(500)]) {
    const chunks = speechChunks(input);
    assert.ok(chunks.every((chunk) => [...chunk].length <= 500 && chunk.trim()));
    if (input) assert.equal(chunks.join("").replace(/\s/g, ""), input.replace(/\s/g, ""));
  }
});

test("player prefetches one chunk, pauses without restarting, replays, and stops", async () => {
  const audio = fakeAudio();
  const errors = [];
  const player = new SpeechPlayer(audio, () => {}, (error) => errors.push(error));
  player.start({ id: "a", text: "First sentence. Second sentence. Third sentence." });
  await until(() => audio.played.length === 1 && audio.generated.length === 2);
  assert.equal(player.state, "playing");
  player.toggle();
  assert.equal(player.state, "paused");
  assert.equal(audio.played[0].paused, true);
  player.toggle();
  assert.equal(audio.played[0].paused, false);
  assert.equal(audio.played.length, 1, "resume does not restart the file");
  player.settings.speed = 1.5;
  audio.played[0].resolve();
  await until(() => audio.played.length === 2);
  assert.equal(audio.generated.at(-1).settings.speed, 1.5, "regenerate the buffered sentence at the new speed");
  player.stop();
  await player.finished;
  assert.equal(player.state, "stopped");
  assert.equal(audio.played[1].signal.aborted, true);
  player.start(player.answer);
  await until(() => audio.played.length === 3);
  assert.equal(audio.played.at(-1).path, "First sentence.");
  await player.close();
  assert.equal(audio.closed, true);
  assert.deepEqual(errors, []);
});

test("late synthesis after stop/replay never plays stale audio; pause during loading waits", async () => {
  const audio = fakeAudio({ deferGeneration: true });
  const player = new SpeechPlayer(audio, () => {}, assert.fail);
  player.start({ id: "old", text: "Old answer." });
  await until(() => audio.generated.length === 1);
  const oldRun = player.finished;
  player.start({ id: "new", text: "New answer." });
  await until(() => audio.generated.length === 2);
  player.toggle();
  audio.generated[0].resolve("old.wav");
  audio.generated[1].resolve("new.wav");
  await oldRun;
  await tick();
  assert.equal(audio.played.length, 0);
  assert.equal(player.state, "paused");
  player.toggle();
  await until(() => audio.played.length === 1);
  assert.equal(audio.played[0].path, "new.wav");
  audio.played[0].resolve();
  await player.finished;
  assert.equal(player.state, "done");
  await player.close();
});

test("synthesis failure remains recoverable without unhandled prefetch rejection", async () => {
  const audio = fakeAudio({ deferGeneration: true });
  const errors = [];
  const player = new SpeechPlayer(audio, () => {}, (error) => errors.push(error));
  player.start({ id: "a", text: "First. Second." });
  await until(() => audio.generated.length === 1);
  audio.generated[0].resolve("first.wav");
  await until(() => audio.generated.length === 2);
  audio.generated[1].reject(new Error("Synthesis unavailable."));
  await tick();
  audio.played[0].resolve();
  await player.finished;
  assert.equal(player.state, "error");
  assert.deepEqual(errors, ["Synthesis unavailable."]);
  await player.close();
});

test("silent preparation transfers in-flight audio, validates final text/settings, and stays bounded", async () => {
  const audio = fakeAudio({ deferGeneration: true });
  const player = new SpeechPlayer(audio, () => {}, assert.fail);
  player.prepare();
  player.prepare("An unfinished sentence");
  assert.equal(audio.generated.length, 0);
  player.prepare("First sentence. More text");
  player.prepare("First sentence. More text arrives.");
  player.prepare(); // A different assistant message arrives while inference is pending.
  player.prepare("Other sentence. More text");
  assert.equal(audio.generated.length, 1, "at most one speculative request in flight");
  assert.equal(audio.warmed.length, 1);
  assert.equal(audio.played.length, 0, "preparation never narrates partial messages");
  audio.generated[0].resolve("first.wav");
  await tick();
  player.prepare("Final sentence.", true);
  player.start({ id: "final", text: "Final sentence." });
  assert.equal(audio.generated[1].signal.aborted, false, "do not kill prepared synthesis at settlement");
  audio.generated[1].resolve("final.wav");
  await until(() => audio.played.length === 1);
  assert.equal(audio.generated.length, 2, "reuse preparation instead of generating again");
  assert.equal(audio.played[0].path, "final.wav");
  audio.played[0].resolve();
  await player.finished;
  await player.close();

  for (const change of ["text", "voice", "speed", "includeAll"]) {
    const fake = fakeAudio();
    const p = new SpeechPlayer(fake, () => {}, assert.fail);
    p.prepare("Prepared sentence.", true);
    await tick();
    if (change === "voice") p.settings.voice = "bf_emma";
    if (change === "speed") p.settings.speed = 1.5;
    if (change === "includeAll") p.includeAll = true;
    const text = change === "text" ? "Revised sentence." : "Prepared sentence.";
    p.start({ id: change, text });
    await until(() => fake.played.length === 1);
    assert.equal(fake.generated.length, 2, `validate ${change} before reusing speculation`);
    assert.equal(fake.played[0].path, text);
    await p.close();
  }
  const cancelled = fakeAudio();
  const p = new SpeechPlayer(cancelled, () => {}, assert.fail);
  p.prepare();
  p.stop();
  assert.equal(cancelled.warmed[0].signal.aborted, true);
  assert.equal(cancelled.played.length, 0);
  await p.close();
});

test("playing status waits for the first buffer and pause during device startup is preserved", async () => {
  const audio = fakeAudio();
  const firstBuffer = Promise.withResolvers();
  const original = audio.play;
  audio.play = (...args) => ({ ...original(...args), started: firstBuffer.promise });
  const player = new SpeechPlayer(audio, () => {}, assert.fail);
  player.start({ id: "a", text: "A sentence." });
  await until(() => audio.played.length === 1);
  assert.equal(player.state, "loading");
  player.toggle();
  firstBuffer.resolve();
  await tick();
  assert.equal(player.state, "paused");
  player.toggle();
  assert.equal(player.state, "playing");
  await player.close();
});

for (const agentDir of [".pi/agent", "custom-agent"]) test(`extension gates autoplay and saves settings under ${agentDir}`, async () => {
  const home = await mkdtemp(join(tmpdir(), "pi-speech-test-"));
  const originalEnv = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
  let speech, validateSettings, answerFromEntry;
  try {
    process.env.HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    if (agentDir === "custom-agent") process.env.PI_CODING_AGENT_DIR = "~/custom-agent";
    ({ default: speech, validateSettings, answerFromEntry } = await import(`../extensions/speech/index.ts?dir=${agentDir}`));
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const config = join(home, agentDir, "pi-dyslexia/speech.json");
  const legacyConfig = join(home, ".config/pi-dyslexia/speech.json");
  const legacySettings = { auto: false, voice: "af_heart", speed: 1, includeAll: false };
  await mkdir(join(home, ".config/pi-dyslexia"), { recursive: true });
  await writeFile(legacyConfig, JSON.stringify(legacySettings));
  const audio = fakeAudio();
  const originals = {};
  for (const method of ["checkReady", "warm", "generate", "play", "close"]) {
    originals[method] = LocalAudio.prototype[method];
    LocalAudio.prototype[method] = audio[method].bind(audio);
  }
  const handlers = new Map(), commands = new Map(), shortcuts = new Map();
  const notices = [], widgets = [];
  const entry = (id, stopReason = "stop", text = "A completed answer.") => ({ type: "message", id,
    message: { role: "assistant", stopReason, content: [{ type: "thinking", thinking: "secret" }, { type: "text", text }] } });
  let branch = [entry("old")];
  let idle = true;
  const context = { mode: "tui", hasUI: true, isIdle: () => idle,
    sessionManager: { getBranch: () => branch, getLeafId: () => branch.at(-1)?.id },
    ui: { notify: (...args) => notices.push(args), setWidget: (...args) => widgets.push(args), select: async (_title, values) => values[0] } };
  try {
    speech({ on: (name, handler) => handlers.set(name, handler), registerCommand: (name, command) => commands.set(name, command), registerShortcut: (key, shortcut) => shortcuts.set(key, shortcut) });
    const event = (name, data = {}) => handlers.get(name)?.(data, context);
    const command = (args) => commands.get("speech").handler(args, context);
    await event("session_start");
    assert.match(widgets.at(-1)[1]().render(200)[0], /auto off/, "read the legacy preference when the new file is missing");
    await command("status");
    assert.ok(notices.at(-1)[0].endsWith(`Settings: ${config}`));
    await command("auto on");
    assert.equal(JSON.parse(await readFile(config, "utf8")).auto, true);
    assert.deepEqual(JSON.parse(await readFile(legacyConfig, "utf8")), legacySettings, "never write to the legacy path");
    await event("session_shutdown");
    await event("session_start");
    assert.match(widgets.at(-1)[1]().render(200)[0], /auto on/, "new settings take precedence over legacy settings");
    await event("agent_settled");
    assert.equal(audio.played.length, 0, "never read restored history automatically");
    await event("agent_start");
    branch.push(entry("tools", "toolUse"));
    await event("agent_settled");
    assert.equal(audio.played.length, 0);
    await event("agent_start");
    const completed = entry("new");
    await event("message_start", { message: completed.message });
    await event("message_update", { message: { ...completed.message, stopReason: "pending", content: [{ type: "text", text: "A completed answer. More text" }] } });
    await tick();
    assert.equal(audio.played.length, 0, "streaming preparation is silent");
    const preparedCount = audio.generated.length;
    await event("message_end", { message: completed.message });
    branch.push(completed);
    idle = false;
    await event("agent_settled");
    assert.equal(audio.played.length, 0);
    idle = true;
    await event("agent_settled");
    await until(() => audio.played.length === 1);
    assert.equal(audio.generated.length, preparedCount, "settlement uses the validated prepared chunk");
    assert.doesNotMatch(audio.generated[0].text, /secret/);
    await event("agent_settled");
    assert.equal(audio.played.length, 1, "no duplicate playback");
    assert.deepEqual(widgets.at(-1)[1]().handleMouse({ type: "click", button: "left", x: 2, y: 1 }), { handled: true });
    assert.equal(audio.played[0].paused, true);
    await event("agent_start");
    branch.push(entry("newer"));
    await event("agent_settled");
    assert.equal(audio.played.length, 1, "new answer does not replace paused selection");
    await command("replay");
    await until(() => audio.played.length === 2);
    await event("input", { source: "interactive" });
    assert.equal(audio.played[1].signal.aborted, true);
    for (const reason of ["aborted", "error", "length", "pending"]) {
      await event("agent_start");
      branch.push(entry(reason, reason));
      await event("agent_settled");
    }
    assert.equal(audio.played.length, 2, "do not fall back to older successful text after an unsuccessful run");
    await event("agent_start");
    const suppressed = entry("suppressed", "stop", "Do not narrate this answer. More text.");
    await event("message_update", { message: { ...suppressed.message, stopReason: "pending" } });
    await tick();
    const speculative = audio.generated.at(-1);
    await command("stop");
    assert.equal(speculative.signal.aborted, true, "stop cancels silent preparation");
    const countAfterStop = audio.generated.length;
    await event("message_update", { message: suppressed.message });
    branch.push(suppressed);
    await event("agent_settled");
    assert.equal(audio.generated.length, countAfterStop, "later tokens do not restart cancelled preparation");
    assert.equal(audio.played.length, 2, "stop suppresses the currently running answer");
    assert.ok(commands.get("speech").getArgumentCompletions("speed ").some((item) => item.value === "speed 1.5"));
    await command("speed 1.5");
    assert.equal(JSON.parse(await readFile(config, "utf8")).speed, 1.5);
    await command("speed 1.25");
    await command("voice bf_emma");
    await command("include all");
    await command("auto off");
    await Promise.all([command("speed 1.25"), command("voice bf_emma")]);
    const saved = JSON.parse(await readFile(config, "utf8"));
    assert.deepEqual(saved, { auto: false, speed: 1.25, voice: "bf_emma", includeAll: true });
    for (const invalid of ["speed NaN", "speed 0", "speed 5", "auto maybe", "voice ../../secret", "stop extra", "auto on extra", "include none"]) {
      await command(invalid);
      assert.equal(notices.at(-1)[1], "error", invalid);
      assert.deepEqual(JSON.parse(await readFile(config, "utf8")), saved);
    }
    assert.throws(() => validateSettings({ ...saved, auto: "true" }));
    assert.throws(() => validateSettings({ ...saved, speed: Infinity }));
    assert.equal(answerFromEntry({ ...entry("call"), message: { ...entry("call").message, content: [{ type: "toolCall" }] } }), undefined);
    branch = [entry("other-branch", "stop", "Another branch.")];
    await event("session_tree");
    await command("");
    await until(() => audio.played.length === 3);
    assert.equal(audio.played.at(-1).path, "Another branch.");
    const component = widgets.at(-1)[1]();
    assert.ok(component.render(12).every((line) => line.length <= 12));
    await shortcuts.get("ctrl+alt+x").handler(context);
    assert.equal(audio.played.at(-1).signal.aborted, true);
    await event("session_shutdown");
    assert.equal(audio.closed, true);
    await event("session_start");
    await event("agent_start");
    branch.push(entry("saved-manual"));
    await event("agent_settled");
    assert.equal(audio.played.length, 3, "saved auto off survives reopening Pi");
    await event("session_shutdown");
    await rm(config);
    await rm(legacyConfig);
    await event("session_start");
    await event("agent_settled");
    assert.equal(audio.played.length, 3, "automatic defaults still never narrate restored history");
    await event("agent_start");
    branch.push(entry("default-auto"));
    await event("agent_settled");
    await until(() => audio.played.length === 4);
    await event("session_shutdown");
    await writeFile(legacyConfig, JSON.stringify({ ...legacySettings, auto: true }));
    await writeFile(config, "{bad json");
    await event("session_start");
    assert.equal(notices.at(-1)[1], "error");
    await event("agent_start");
    branch.push(entry("bad-settings-manual"));
    await event("agent_settled");
    assert.equal(audio.played.length, 4, "malformed settings never enable automatic speech or fall back to legacy settings");
    await event("session_shutdown");
    await rm(config);
    await mkdir(config);
    await event("session_start");
    assert.equal(notices.at(-1)[1], "error");
    assert.match(widgets.at(-1)[1]().render(200)[0], /auto off/, "unreadable settings must not fall back to legacy settings");
    await event("session_shutdown");
    await rm(config, { recursive: true });
    await writeFile(legacyConfig, "{bad json");
    await event("session_start");
    assert.equal(notices.at(-1)[1], "error");
    assert.match(widgets.at(-1)[1]().render(200)[0], /auto off/, "invalid legacy settings also use manual defaults");
    await event("session_shutdown");
    for (const mode of ["rpc", "print", "json"]) {
      await handlers.get("session_start")({}, { mode });
      await handlers.get("agent_start")({}, { mode });
      await handlers.get("agent_settled")({}, { mode });
      await commands.get("speech").handler("", { mode });
    }
    assert.equal(audio.played.length, 4);
  } finally {
    await handlers.get("session_shutdown")?.();
    Object.assign(LocalAudio.prototype, originals);
    await rm(home, { recursive: true, force: true });
  }
});
