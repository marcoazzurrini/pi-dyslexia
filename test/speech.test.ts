import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import test from "node:test";
import { setImmediate as tick } from "node:timers/promises";

import type { ExtensionEvent } from "@earendil-works/pi-coding-agent";

import { LocalAudio } from "../extensions/speech/audio.ts";
import type { SynthesisSettings } from "../extensions/speech/audio.ts";
import type * as SpeechModule from "../extensions/speech/index.ts";
import { SpeechPlayer } from "../extensions/speech/player.ts";
import { speechChunks } from "../extensions/speech/text.ts";
import {
  assistantEntry,
  extensionHarness,
  last,
  noop,
  restoreEnvironment,
  testContext,
  until,
  widget,
} from "./helpers.ts";
import type { Notices, Widgets } from "./helpers.ts";

type Generation = PromiseWithResolvers<string> & {
  settings: SynthesisSettings;
  signal: AbortSignal;
  text: string;
};
type Playback = PromiseWithResolvers<void> & {
  path: string;
  paused: boolean;
  speed: number;
  signal: AbortSignal;
};

const fakeAudio = ({ deferGeneration = false } = {}) => {
  const generated: Generation[] = [];
  const played: Playback[] = [];
  const warmed: { settings: SynthesisSettings; signal: AbortSignal }[] = [];
  return {
    checkReady() {
      return Promise.resolve(true);
    },
    close() {
      this.closed = true;
      return Promise.resolve();
    },
    closed: false,
    generate(text: string, settings: SynthesisSettings, signal: AbortSignal) {
      const deferred = Promise.withResolvers<string>();
      generated.push({ settings, signal, text, ...deferred });
      return deferGeneration ? deferred.promise : Promise.resolve(text);
    },
    generated,
    play(path: string, signal: AbortSignal, speed = 1) {
      const deferred: PromiseWithResolvers<void> = Promise.withResolvers();
      const entry = { path, paused: false, signal, speed, ...deferred };
      played.push(entry);
      signal.addEventListener("abort", () => deferred.reject(signal.reason), {
        once: true,
      });
      return {
        done: deferred.promise,
        pause: () => {
          entry.paused = true;
        },
        resume: () => {
          entry.paused = false;
        },
        setSpeed: (rate: number) => {
          entry.speed = rate;
        },
        started: Promise.resolve(0),
      };
    },
    played,
    warm(settings: SynthesisSettings, signal: AbortSignal) {
      warmed.push({ settings, signal });
      return Promise.resolve();
    },
    warmed,
  };
};

test("speech rendering preserves meaning and announces omissions", () => {
  const markdown = `# Warning\n\nDo **not** delete \`backup.sql\`. Keep 12.5% and v1.2.3 unchanged.\n\n1. First action.\n2. Second action.\n\n[Docs](https://example.com/a?q=1&x=2) and https://example.com/private\n\n\`\`\`sh\nrm -rf example\n\`\`\`\n\n| Name | Value |\n| --- | --- |\n| timeout | 250 ms |\n\nA &amp; B; ~~safe~~ unsafe.\n\n![Diagram](diagram.png)`;
  const text = speechChunks(markdown).join(" ");
  assert.match(text, /Do not delete backup\.sql/u);
  assert.match(text, /12\.5% and v1\.2\.3/u);
  assert.match(text, /1\. First action\. 2\. Second action/u);
  assert.match(text, /Docs \(link destination skipped\)/u);
  assert.match(text, /URL skipped/u);
  assert.match(text, /Code block skipped/u);
  assert.doesNotMatch(text, /rm -rf|https:/u);
  assert.match(text, /Name; Value.*timeout; 250 ms/u);
  assert.match(text, /A & B/u);
  assert.match(text, /Deleted text: safe\. End deleted text/u);
  assert.match(text, /Image: Diagram/u);
  assert.match(
    speechChunks("> This is quoted, not an instruction.").join(" "),
    /Quote\. This is quoted, not an instruction\. End quote\./u
  );
  assert.equal(
    speechChunks("`&amp;`", true).join(" "),
    "&amp;",
    "do not decode HTML entities inside executable text"
  );
  const all = speechChunks(markdown, true).join(" ");
  assert.match(all, /rm -rf example/u);
  assert.match(all, /https:\/\/example.com\/a\?q=1&x=2/u);
  assert.match(all, /End code block/u);
  for (const input of [
    "",
    "a".repeat(1500),
    "😀".repeat(1001),
    "word ".repeat(500),
  ]) {
    const chunks = speechChunks(input);
    assert.ok(
      chunks.every((chunk) => [...chunk].length <= 500 && chunk.trim())
    );
    if (input) {
      assert.equal(
        chunks.join("").replaceAll(/\s/gu, ""),
        input.replaceAll(/\s/gu, "")
      );
    }
  }
});

test("player prefetches one chunk, pauses without restarting, replays, and stops", async () => {
  const audio = fakeAudio();
  const errors: string[] = [];
  const player = new SpeechPlayer(audio, noop, (error) => errors.push(error));
  player.start({
    id: "a",
    text: "First sentence. Second sentence. Third sentence.",
  });
  await until(() => audio.played.length === 1 && audio.generated.length === 2);
  assert.equal(player.state, "playing");
  player.toggle();
  assert.equal(player.state, "paused");
  assert.equal(audio.played[0].paused, true);
  player.toggle();
  assert.equal(audio.played[0].paused, false);
  assert.equal(audio.played.length, 1, "resume does not restart the file");
  player.settings = { ...player.settings, speed: 1.5 };
  assert.equal(audio.played[0].speed, 1.5, "change the active playback rate");
  assert.equal(
    audio.generated.length,
    2,
    "speed changes do not regenerate speech"
  );
  audio.played[0].resolve();
  await until(() => audio.played.length === 2 && audio.generated.length === 3);
  assert.equal(audio.played[1].speed, 1.5);
  assert.deepEqual(
    audio.generated.map(({ settings }) => settings),
    [{ voice: "af_heart" }, { voice: "af_heart" }, { voice: "af_heart" }]
  );
  player.stop();
  await player.finished;
  assert.equal(player.state, "stopped");
  assert.equal(audio.played[1].signal.aborted, true);
  assert.ok(player.answer);
  player.start(player.answer);
  await until(() => audio.played.length === 3);
  assert.equal(last(audio.played).path, "First sentence.");
  await player.close();
  assert.equal(audio.closed, true);
  assert.deepEqual(errors, []);
});

test("late synthesis after stop/replay never plays stale audio; pause during loading waits", async () => {
  const audio = fakeAudio({ deferGeneration: true });
  const player = new SpeechPlayer(audio, noop, assert.fail);
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
  const errors: string[] = [];
  const player = new SpeechPlayer(audio, noop, (error) => errors.push(error));
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
  const player = new SpeechPlayer(audio, noop, assert.fail);
  player.prepare();
  player.prepare("An unfinished sentence");
  assert.equal(audio.generated.length, 0);
  player.prepare("First sentence. More text");
  player.prepare("First sentence. More text arrives.");
  // A different assistant message arrives while inference is pending.
  player.prepare();
  player.prepare("Other sentence. More text");
  assert.equal(
    audio.generated.length,
    1,
    "at most one speculative request in flight"
  );
  assert.equal(audio.warmed.length, 1);
  assert.equal(
    audio.played.length,
    0,
    "preparation never narrates partial messages"
  );
  audio.generated[0].resolve("first.wav");
  await tick();
  player.prepare("Final sentence.", true);
  player.start({ id: "final", text: "Final sentence." });
  assert.equal(
    audio.generated[1].signal.aborted,
    false,
    "do not kill prepared synthesis at settlement"
  );
  audio.generated[1].resolve("final.wav");
  await until(() => audio.played.length === 1);
  assert.equal(
    audio.generated.length,
    2,
    "reuse preparation instead of generating again"
  );
  assert.equal(audio.played[0].path, "final.wav");
  audio.played[0].resolve();
  await player.finished;
  await player.close();

  for await (const change of ["text", "voice", "speed", "includeAll"]) {
    const fake = fakeAudio();
    const p = new SpeechPlayer(fake, noop, assert.fail);
    p.prepare("Prepared sentence.", true);
    await tick();
    if (change === "voice") {
      p.settings = { ...p.settings, voice: "bf_emma" };
    }
    if (change === "speed") {
      p.settings = { ...p.settings, speed: 1.5 };
    }
    if (change === "includeAll") {
      p.includeAll = true;
    }
    const text = change === "text" ? "Revised sentence." : "Prepared sentence.";
    p.start({ id: change, text });
    await until(() => fake.played.length === 1);
    assert.equal(
      fake.generated.length,
      change === "speed" ? 1 : 2,
      `validate ${change} without discarding audio for playback-only changes`
    );
    assert.equal(fake.played[0].path, text);
    assert.equal(fake.played[0].speed, change === "speed" ? 1.5 : 1);
    await p.close();
  }
  const cancelled = fakeAudio();
  const p = new SpeechPlayer(cancelled, noop, assert.fail);
  p.prepare();
  p.stop();
  assert.equal(cancelled.warmed[0].signal.aborted, true);
  assert.equal(cancelled.played.length, 0);
  await p.close();
});

test("speed changes during synthesis preserve in-flight audio and use the latest playback rate", async () => {
  const audio = fakeAudio({ deferGeneration: true });
  const player = new SpeechPlayer(audio, noop, assert.fail);
  player.settings = { speed: 1.25, voice: "af_heart" };
  player.start({ id: "speed", text: "Keep the original sentence." });
  await until(() => audio.generated.length === 1);
  player.settings = { ...player.settings, speed: 1.5 };
  player.toggle();
  audio.generated[0].resolve("original.wav");
  await tick();
  assert.equal(audio.played.length, 0);
  player.settings = { ...player.settings, speed: 2 };
  player.toggle();
  await until(() => audio.played.length === 1);
  assert.equal(audio.generated.length, 1);
  assert.deepEqual(audio.generated[0].settings, { voice: "af_heart" });
  assert.equal(audio.played[0].speed, 2);
  assert.equal(audio.played[0].path, "original.wav");
  player.settings = { ...player.settings, speed: 0.5 };
  assert.equal(audio.played[0].speed, 0.5);
  await player.close();
});

test("playing status waits for the first buffer and pause during device startup is preserved", async () => {
  const audio = fakeAudio();
  const firstBuffer = Promise.withResolvers<number>();
  const original = audio.play;
  audio.play = (...args) => ({
    ...original(...args),
    started: firstBuffer.promise,
  });
  const player = new SpeechPlayer(audio, noop, assert.fail);
  player.start({ id: "a", text: "A sentence." });
  await until(() => audio.played.length === 1);
  assert.equal(player.state, "loading");
  player.toggle();
  firstBuffer.resolve(0);
  await tick();
  assert.equal(player.state, "paused");
  player.toggle();
  assert.equal(player.state, "playing");
  await player.close();
});

for (const agentDir of [".pi/agent", "custom-agent"]) {
  test(`extension gates autoplay and saves settings under ${agentDir}`, async (t) => {
    const home = await mkdtemp(nodePath.join(tmpdir(), "pi-speech-test-"));
    const originalEnv = {
      HOME: process.env.HOME,
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    };
    let answerFromEntry: typeof SpeechModule.answerFromEntry;
    let parseSettings: typeof SpeechModule.parseSettings;
    let speech: typeof SpeechModule.default;
    try {
      process.env.HOME = home;
      delete process.env.PI_CODING_AGENT_DIR;
      if (agentDir === "custom-agent") {
        process.env.PI_CODING_AGENT_DIR = "~/custom-agent";
      }
      ({
        default: speech,
        parseSettings,
        answerFromEntry,
      } = await import(`../extensions/speech/index.ts?dir=${agentDir}`));
    } finally {
      restoreEnvironment(originalEnv);
    }
    const config = nodePath.join(home, agentDir, "pi-dyslexia/speech.json");
    const legacyConfig = nodePath.join(home, ".config/pi-dyslexia/speech.json");
    const legacySettings = {
      auto: false,
      includeAll: false,
      speed: 1,
      voice: "af_heart",
    };
    await mkdir(nodePath.join(home, ".config/pi-dyslexia"), {
      recursive: true,
    });
    await writeFile(legacyConfig, JSON.stringify(legacySettings));
    const audio = fakeAudio();
    for (const method of [
      "checkReady",
      "warm",
      "generate",
      "play",
      "close",
    ] as const) {
      t.mock.method(LocalAudio.prototype, method, audio[method].bind(audio));
    }
    const { api, handlers, commands, shortcuts } = extensionHarness();
    const notices: Notices = [];
    const widgets: Widgets = [];
    let branch = [assistantEntry("old")];
    let idle = true;
    const context = testContext({
      hasUI: true,
      isIdle: () => idle,
      mode: "tui",
      sessionManager: {
        getBranch: () => branch,
        getLeafId: () => branch.at(-1)?.id ?? null,
      },
      ui: {
        notify: (...args) => notices.push(args),
        select: (_title, values) => Promise.resolve(values[0]),
        setWidget: (...args) => {
          widgets.push(args);
        },
      },
    });
    try {
      speech(api);
      const event = <K extends ExtensionEvent["type"]>(
        name: K,
        data: Partial<Omit<Extract<ExtensionEvent, { type: K }>, "type">> = {}
      ) => handlers.get(name)(data, context);
      const command = (args: string) =>
        commands.get("speech").handler(args, context);
      await event("session_start");
      assert.match(
        widget(widgets).render(200)[0],
        /auto off/u,
        "read the legacy preference when the new file is missing"
      );
      await command("status");
      assert.ok(last(notices)[0].endsWith(`Settings: ${config}`));
      await command("auto on");
      assert.equal(JSON.parse(await readFile(config, "utf-8")).auto, true);
      assert.deepEqual(
        JSON.parse(await readFile(legacyConfig, "utf-8")),
        legacySettings,
        "never write to the legacy path"
      );
      await event("session_shutdown");
      await event("session_start");
      assert.match(
        widget(widgets).render(200)[0],
        /auto on/u,
        "new settings take precedence over legacy settings"
      );
      await event("agent_settled");
      assert.equal(
        audio.played.length,
        0,
        "never read restored history automatically"
      );
      await event("agent_start");
      branch.push(assistantEntry("tools", "toolUse"));
      await event("agent_settled");
      assert.equal(audio.played.length, 0);
      await event("agent_start");
      const completed = assistantEntry("new");
      await event("message_start", { message: completed.message });
      await event("message_update", {
        message: {
          ...completed.message,
          content: [{ text: "A completed answer. More text", type: "text" }],
          stopReason: "pending",
        },
      });
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
      assert.equal(
        audio.generated.length,
        preparedCount,
        "settlement uses the validated prepared chunk"
      );
      assert.doesNotMatch(audio.generated[0].text, /secret/u);
      await event("agent_settled");
      assert.equal(audio.played.length, 1, "no duplicate playback");
      const playingWidget = widget(widgets);
      assert.deepEqual(playingWidget.render(200), [
        "Speech: playing | 1x | auto on",
      ]);
      assert.equal(playingWidget.handleMouse, undefined);
      await command("");
      assert.equal(audio.played[0].paused, true);
      await command("speed 1.25");
      assert.equal(audio.played[0].speed, 1.25);
      assert.equal(
        audio.played.length,
        1,
        "changing speed does not restart playback"
      );
      assert.deepEqual(widget(widgets).render(200), [
        "Speech: paused | 1.25x | auto on",
      ]);
      await event("agent_start");
      branch.push(assistantEntry("newer"));
      await event("agent_settled");
      assert.equal(
        audio.played.length,
        1,
        "new answer does not replace paused selection"
      );
      await command("replay");
      await until(() => audio.played.length === 2);
      await event("input", { source: "interactive" });
      assert.equal(audio.played[1].signal.aborted, true);
      for await (const reason of [
        "aborted",
        "error",
        "length",
        "pending",
      ] as const) {
        await event("agent_start");
        branch.push(assistantEntry(reason, reason));
        await event("agent_settled");
      }
      assert.equal(
        audio.played.length,
        2,
        "do not fall back to older successful text after an unsuccessful run"
      );
      await event("agent_start");
      const suppressed = assistantEntry(
        "suppressed",
        "stop",
        "Do not narrate this answer. More text."
      );
      await event("message_update", {
        message: { ...suppressed.message, stopReason: "pending" },
      });
      await tick();
      const speculative = last(audio.generated);
      await command("stop");
      assert.equal(
        speculative.signal.aborted,
        true,
        "stop cancels silent preparation"
      );
      const countAfterStop = audio.generated.length;
      await event("message_update", { message: suppressed.message });
      branch.push(suppressed);
      await event("agent_settled");
      assert.equal(
        audio.generated.length,
        countAfterStop,
        "later tokens do not restart cancelled preparation"
      );
      assert.equal(
        audio.played.length,
        2,
        "stop suppresses the currently running answer"
      );
      const completions = await commands
        .get("speech")
        .getArgumentCompletions?.("speed ");
      assert.ok(completions?.some((item) => item.value === "speed 1.5"));
      await command("speed 1.5");
      assert.equal(JSON.parse(await readFile(config, "utf-8")).speed, 1.5);
      await command("speed 1.25");
      await command("voice bf_emma");
      await command("include all");
      await command("auto off");
      await Promise.all([command("speed 1.25"), command("voice bf_emma")]);
      const saved = JSON.parse(await readFile(config, "utf-8"));
      assert.deepEqual(saved, {
        auto: false,
        includeAll: true,
        speed: 1.25,
        voice: "bf_emma",
      });
      for await (const invalid of [
        "speed NaN",
        "speed 0",
        "speed 5",
        "auto maybe",
        "voice ../../secret",
        "stop extra",
        "auto on extra",
        "include none",
      ]) {
        await command(invalid);
        assert.equal(last(notices)[1], "error", invalid);
        assert.deepEqual(JSON.parse(await readFile(config, "utf-8")), saved);
      }
      assert.throws(() =>
        parseSettings(JSON.stringify({ ...saved, auto: "true" }))
      );
      assert.throws(() =>
        parseSettings(JSON.stringify({ ...saved, speed: Infinity }))
      );
      assert.equal(
        answerFromEntry({
          ...assistantEntry("call"),
          message: {
            ...assistantEntry("call").message,
            content: [
              { arguments: {}, id: "call", name: "test", type: "toolCall" },
            ],
          },
        }),
        undefined
      );
      branch = [assistantEntry("other-branch", "stop", "Another branch.")];
      await event("session_tree");
      await command("");
      await until(() => audio.played.length === 3);
      assert.equal(last(audio.played).path, "Another branch.");
      const component = widget(widgets);
      assert.equal(component.render(200).length, 1);
      assert.deepEqual(component.render(12), ["Speech: play"]);
      await shortcuts.get("ctrl+alt+x").handler(context);
      assert.equal(last(audio.played).signal.aborted, true);
      await event("session_shutdown");
      assert.equal(audio.closed, true);
      await event("session_start");
      await event("agent_start");
      branch.push(assistantEntry("saved-manual"));
      await event("agent_settled");
      assert.equal(
        audio.played.length,
        3,
        "saved auto off survives reopening Pi"
      );
      await event("session_shutdown");
      await rm(config);
      await rm(legacyConfig);
      await event("session_start");
      await event("agent_settled");
      assert.equal(
        audio.played.length,
        3,
        "automatic defaults still never narrate restored history"
      );
      await event("agent_start");
      branch.push(assistantEntry("default-auto"));
      await event("agent_settled");
      await until(() => audio.played.length === 4);
      await event("session_shutdown");
      await writeFile(
        legacyConfig,
        JSON.stringify({ ...legacySettings, auto: true })
      );
      await writeFile(config, "{bad json");
      await event("session_start");
      assert.equal(last(notices)[1], "error");
      await event("agent_start");
      branch.push(assistantEntry("bad-settings-manual"));
      await event("agent_settled");
      assert.equal(
        audio.played.length,
        4,
        "malformed settings never enable automatic speech or fall back to legacy settings"
      );
      await event("session_shutdown");
      await rm(config);
      await mkdir(config);
      await event("session_start");
      assert.equal(last(notices)[1], "error");
      assert.match(
        widget(widgets).render(200)[0],
        /auto off/u,
        "unreadable settings must not fall back to legacy settings"
      );
      await event("session_shutdown");
      await rm(config, { recursive: true });
      await writeFile(legacyConfig, "{bad json");
      await event("session_start");
      assert.equal(last(notices)[1], "error");
      assert.match(
        widget(widgets).render(200)[0],
        /auto off/u,
        "invalid legacy settings also use manual defaults"
      );
      await event("session_shutdown");
      for await (const mode of ["rpc", "print", "json"] as const) {
        const headless = testContext({ mode });
        await handlers.get("session_start")({}, headless);
        await handlers.get("agent_start")({}, headless);
        await handlers.get("agent_settled")({}, headless);
        await commands.get("speech").handler("", headless);
      }
      assert.equal(audio.played.length, 4);
    } finally {
      await handlers.get("session_shutdown")({}, context);
      t.mock.restoreAll();
      await rm(home, { force: true, recursive: true });
    }
  });
}
