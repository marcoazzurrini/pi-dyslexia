import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import test from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import type { ExtensionEvent } from "@earendil-works/pi-coding-agent";

import { LocalAudio } from "../extensions/speech/audio.ts";
import type * as SpeechModule from "../extensions/speech/index.ts";
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
import type { AssistantEntry, Notices, Widgets } from "./helpers.ts";

test(
  "first-run setup is optional, remembered, consented, retryable, and gates every playback path",
  {
    skip: process.platform !== "darwin" || process.arch !== "arm64",
  },
  async (t) => {
    const home = await mkdtemp(nodePath.join(tmpdir(), "pi-speech-setup-"));
    const env = {
      HOME: process.env.HOME,
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    };
    let speech: typeof SpeechModule.default;
    try {
      process.env.HOME = home;
      delete process.env.PI_CODING_AGENT_DIR;
      ({ default: speech } = await import(
        `../extensions/speech/index.ts?setup=${home}`
      ));
    } finally {
      restoreEnvironment(env);
    }
    let consent = false;
    let failPlayback = false;
    let installWorks = false;
    let installed = false;
    let choice = "Not now";
    let result = {
      code: 1,
      killed: false,
      stderr: "Network unavailable.",
      stdout: "",
    };
    let checks = 0;
    let confirmations = 0;
    let generated = 0;
    let prompts = 0;
    let pendingInstall: PromiseWithResolvers<void> | undefined;
    const executions: { signal: AbortSignal }[] = [];
    const fake = {
      checkReady() {
        checks += 1;
        return Promise.resolve(installed);
      },
      close: () => Promise.resolve(),
      generate() {
        generated += 1;
        if (failPlayback) {
          return Promise.reject(new Error("Test synthesis failure."));
        }
        return Promise.resolve("test.wav");
      },
      install(signal: AbortSignal) {
        executions.push({ signal });
        if (pendingInstall) {
          const pending = pendingInstall;
          signal.addEventListener("abort", () => pending.resolve(), {
            once: true,
          });
          return pending.promise;
        }
        if (result.code !== 0) {
          return Promise.reject(new Error(result.stderr));
        }
        installed = installWorks;
        return Promise.resolve();
      },
      play() {
        return {
          done: Promise.resolve(),
          pause: noop,
          resume: noop,
          started: Promise.resolve(0),
        };
      },
      warm: () => Promise.resolve(),
    } satisfies Pick<
      LocalAudio,
      "checkReady" | "close" | "generate" | "install" | "play" | "warm"
    >;
    for (const name of [
      "checkReady",
      "close",
      "generate",
      "install",
      "play",
      "warm",
    ] as const) {
      t.mock.method(LocalAudio.prototype, name, fake[name]);
    }
    const { api, handlers, commands, shortcuts } = extensionHarness();
    const notices: Notices = [];
    const widgets: Widgets = [];
    const branch: AssistantEntry[] = [];
    const context = testContext({
      hasUI: true,
      isIdle: () => true,
      mode: "tui",
      sessionManager: {
        getBranch: () => branch,
        getLeafId: () => branch.at(-1)?.id ?? null,
      },
      ui: {
        confirm(title, message) {
          confirmations += 1;
          assert.match(title, /Set up read-aloud/u);
          for (const term of [
            "Swift 6",
            "command-line tools",
            "FluidAudio",
            "pronunciation",
            "Kokoro",
            "Internet",
            "disk space",
            "No audio",
          ]) {
            assert.ok(message.includes(term), term);
          }
          return Promise.resolve(consent);
        },
        notify: (...args) => notices.push(args),
        select(title, options) {
          prompts += 1;
          assert.match(title, /Text responses already work/u);
          assert.deepEqual(options, ["Set up read-aloud", "Not now"]);
          return Promise.resolve(choice);
        },
        setWidget: (...args) => {
          widgets.push(args);
        },
      },
    });
    speech(api);
    const event = <K extends ExtensionEvent["type"]>(
      name: K,
      data: Partial<Omit<Extract<ExtensionEvent, { type: K }>, "type">> = {}
    ) => handlers.get(name)(data, context);
    const command = (args: string) =>
      commands.get("speech").handler(args, context);
    const answer = async () => {
      await event("input", { source: "interactive" });
      await event("agent_start");
      branch.push(assistantEntry(String(branch.length)));
      await event("agent_settled");
      await tick();
    };
    try {
      await event("session_start");
      assert.equal(prompts, 1);
      assert.equal(executions.length, 0);
      assert.equal(confirmations, 0);
      assert.equal(checks, 1);
      assert.deepEqual(widget(widgets).render(200), [
        "Speech: setup needed | 1x | auto inactive",
        "Text responses work. Use /speech setup to enable read-aloud.",
      ]);
      assert.equal(
        await readFile(
          nodePath.join(home, ".pi/agent/pi-dyslexia/speech-setup-prompted"),
          "utf-8"
        ),
        ""
      );
      const count = notices.length;
      await answer();
      await answer();
      assert.equal(
        notices.length,
        count,
        "no error after answers when setup is missing"
      );
      assert.equal(generated, 0);
      assert.equal(checks, 1, "do not probe again after each answer");
      for await (const action of [
        "",
        "preview",
        "latest",
        "replay",
        "previous",
      ]) {
        await command(action);
        assert.match(last(notices)[0], /\/speech setup/u);
        assert.equal(last(notices)[1], "info");
      }
      await shortcuts.get("ctrl+alt+s").handler(context);
      assert.equal(generated, 0);
      await event("session_shutdown");
      await event("session_start");
      assert.equal(prompts, 1, "Not now survives reopening Pi");
      const completions = await commands
        .get("speech")
        .getArgumentCompletions?.("set");
      assert.ok(completions?.some((item) => item.value === "setup"));
      await command("setup");
      assert.equal(confirmations, 1);
      assert.equal(executions.length, 0, "no installation without consent");
      consent = true;
      await command("setup");
      assert.equal(executions.length, 1);
      assert.match(
        last(notices)[0],
        /did not finish.*Text responses still work[\s\S]*Network unavailable[\s\S]*\/speech setup/u
      );
      assert.equal(last(notices)[1], "error");
      await answer();
      assert.equal(generated, 0);
      result = { code: 0, killed: false, stderr: "", stdout: "Complete." };
      await command("setup");
      assert.match(last(notices)[0], /did not pass the readiness check/u);
      await answer();
      assert.equal(
        generated,
        0,
        "an installer exit code alone never enables speech"
      );
      await command("auto off");
      installWorks = true;
      await command("setup");
      assert.match(
        last(notices)[0],
        /Read-aloud is ready.*Automatic narration is off/u
      );
      assert.equal(generated, 0, "setup never plays audio or old answers");
      await answer();
      assert.equal(generated, 0, "setup preserves saved auto off");
      await command("auto on");
      await answer();
      assert.equal(generated, 1, "future answers play after verified setup");
      failPlayback = true;
      await answer();
      const errors = notices.filter(([, type]) => type === "error").length;
      await answer();
      assert.equal(
        generated,
        2,
        "runtime failure suspends autoplay even after another input stops the player"
      );
      assert.equal(
        notices.filter(([, type]) => type === "error").length,
        errors
      );
      failPlayback = false;
      pendingInstall = Promise.withResolvers();
      const running = command("setup");
      await tick();
      const installs = executions.length;
      assert.deepEqual(widget(widgets).render(200), [
        "Speech: setting up | 1x | auto inactive | newer answer: /speech latest",
        "Downloading and installing. Text responses still work.",
      ]);
      await command("setup");
      assert.equal(
        executions.length,
        installs,
        "only one installer per session"
      );
      assert.match(last(notices)[0], /already running/u);
      await event("session_shutdown");
      await running;
      assert.equal(last(executions).signal.aborted, true);
      assert.equal(
        notices.filter(([, type]) => type === "error").length,
        errors,
        "shutdown does not report a setup error"
      );
      pendingInstall = undefined;
      installed = false;
      choice = "Set up read-aloud";
      await rm(
        nodePath.join(home, ".pi/agent/pi-dyslexia/speech-setup-prompted")
      );
      await event("session_start");
      assert.equal(prompts, 2);
      assert.equal(
        executions.length,
        installs + 1,
        "first-launch setup runs the same consented installer"
      );
      assert.match(last(notices)[0], /Read-aloud is ready/u);
      assert.equal(generated, 2);
      await event("session_shutdown");
      const before = {
        checks,
        confirmations,
        executions: executions.length,
        prompts,
      };
      for await (const mode of ["rpc", "print", "json"] as const) {
        const headless = testContext({ mode });
        await handlers.get("session_start")({}, headless);
        await commands.get("speech").handler("setup", headless);
      }
      assert.deepEqual(
        { checks, confirmations, executions: executions.length, prompts },
        before
      );
    } finally {
      await event("session_shutdown");
      t.mock.restoreAll();
      await rm(home, { force: true, recursive: true });
    }
  }
);

test(
  "native setup checks tools, builds, verifies, and cancels its process group without real downloads",
  {
    skip: process.platform !== "darwin" || process.arch !== "arm64",
  },
  async () => {
    const home = await mkdtemp(nodePath.join(tmpdir(), "pi setup shell "));
    const env = {
      FAIL_CHECK: process.env.FAIL_CHECK,
      HOME: process.env.HOME,
      LEGACY_CHECK: process.env.LEGACY_CHECK,
      MISSING_TOOLS: process.env.MISSING_TOOLS,
      PATH: process.env.PATH,
    };
    const script = (name: string, text: string) =>
      writeFile(nodePath.join(home, name), `#!/bin/sh\nset -eu\n${text}\n`, {
        mode: 0o700,
      });
    let audio: LocalAudio | undefined;
    try {
      await mkdir(nodePath.join(home, "bin"));
      for await (const [name, path] of [
        ["sh", "/bin/sh"],
        ["rm", "/bin/rm"],
        ["dirname", "/usr/bin/dirname"],
        ["mkdir", "/bin/mkdir"],
        ["mv", "/bin/mv"],
        ["install", "/usr/bin/install"],
        ["basename", "/usr/bin/basename"],
        ["ditto", "/usr/bin/ditto"],
      ] as const) {
        await symlink(path, nodePath.join(home, "bin", name));
      }
      await script(
        "bin/uname",
        'if [ "$1" = -s ]; then echo Darwin; else echo arm64; fi'
      );
      await script("bin/xcrun", `exit "\${MISSING_TOOLS:-0}"`);
      await script(
        "bin/swift",
        `
      printf 'swift:%s\\n' "$*" >> "$HOME/log"
      case "$*" in
        *--show-bin-path*) printf '%s\\n' "$HOME/build" ;;
        *) /bin/mkdir -p "$HOME/build/PiSpeech_PiSpeech.bundle"
           /bin/cp "$HOME/fake-worker" "$HOME/build/pi-speech" ;;
      esac
    `
      );
      await script("bin/node", 'printf "assets:%s\\n" "$*" >> "$HOME/log"');
      await script(
        "fake-worker",
        `
      printf 'worker:%s\\n' "$*" >> "$HOME/log"
      test "$CFFIXED_USER_HOME" = "$PI_DYSLEXIA_NATIVE_HOME"
      test "\${FAIL_CHECK:-0}" = 0
      if [ "\${LEGACY_CHECK:-0}" = 0 ]; then
        printf '%s\\n' '{"ready":true,"albert":"cpuAndGPU"}'
      fi
    `
      );
      await copyFile(
        new URL("../extensions/speech/audio.ts", import.meta.url),
        nodePath.join(home, "audio.ts")
      );
      await copyFile(
        new URL("../extensions/speech/runtime.ts", import.meta.url),
        nodePath.join(home, "runtime.ts")
      );
      await copyFile(
        new URL("../extensions/speech/async.ts", import.meta.url),
        nodePath.join(home, "async.ts")
      );
      await mkdir(nodePath.join(home, "native"));
      await copyFile(
        new URL("../extensions/speech/native/setup.sh", import.meta.url),
        nodePath.join(home, "native/setup.sh")
      );
      process.env.HOME = home;
      process.env.PATH = nodePath.join(home, "bin");
      delete process.env.FAIL_CHECK;
      delete process.env.LEGACY_CHECK;
      delete process.env.MISSING_TOOLS;
      const { LocalAudio: IsolatedAudio }: { LocalAudio: typeof LocalAudio } =
        await import(pathToFileURL(nodePath.join(home, "audio.ts")).href);
      audio = new IsolatedAudio();
      assert.equal(
        await audio.checkReady(),
        false,
        "a missing native executable is a readiness state, not a thrown error"
      );
      process.env.MISSING_TOOLS = "1";
      await assert.rejects(
        audio.install(new AbortController().signal),
        /Install Swift 6/u
      );
      delete process.env.MISSING_TOOLS;
      await audio.install(new AbortController().signal);
      assert.equal(await audio.checkReady(), true);
      let log = await readFile(nodePath.join(home, "log"), "utf-8");
      assert.match(
        log,
        /swift:build .* -c release .*--disable-automatic-resolution/u
      );
      assert.match(log, /assets:.*assets.ts/u);
      assert.match(log, /worker:--verify/u);
      assert.match(log, /worker:--check/u);
      await audio.install(new AbortController().signal);
      log = await readFile(nodePath.join(home, "log"), "utf-8");
      assert.equal(
        log.match(/worker:--verify/gu)?.length,
        2,
        "repair verifies every installation"
      );
      process.env.LEGACY_CHECK = "1";
      assert.equal(
        await audio.checkReady(),
        false,
        "an old experimental binary requires rebuilding"
      );
      delete process.env.LEGACY_CHECK;
      process.env.FAIL_CHECK = "1";
      assert.equal(
        await audio.checkReady(),
        false,
        "incomplete installations fail the offline check"
      );
      await assert.rejects(audio.install(new AbortController().signal));
      delete process.env.FAIL_CHECK;
      await script(
        "native/setup.sh",
        '/bin/sleep 60 &\necho "$!" > "$HOME/child.pid"\nwait'
      );
      const controller = new AbortController();
      const running = assert.rejects(audio.install(controller.signal));
      let pid;
      try {
        pid = await until<number | false>(
          async () => {
            try {
              return Number(
                await readFile(nodePath.join(home, "child.pid"), "utf-8")
              );
            } catch (error) {
              if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
              ) {
                return false;
              }
              throw error;
            }
          },
          100,
          10
        );
      } finally {
        controller.abort();
      }
      await running;
      assert.ok(pid && pid > 0, "the installer started a child process");
      await until(
        () => {
          try {
            process.kill(pid, 0);
            return false;
          } catch (error) {
            if (
              error instanceof Error &&
              "code" in error &&
              error.code === "ESRCH"
            ) {
              return true;
            }
            throw error;
          }
        },
        100,
        10
      );
      assert.throws(
        () => process.kill(pid, 0),
        { code: "ESRCH" },
        "cancellation stops descendants, not only the installer shell"
      );
    } finally {
      await audio?.close();
      restoreEnvironment(env);
      await rm(home, { force: true, recursive: true });
    }
  }
);
