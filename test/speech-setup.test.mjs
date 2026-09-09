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
import { pathToFileURL } from "node:url";

import { LocalAudio } from "../extensions/speech/audio.ts";
import { noop, restoreEnvironment, tick, until } from "./helpers.mjs";

test(
  "first-run setup is optional, remembered, consented, retryable, and gates every playback path",
  {
    skip: process.platform !== "darwin" || process.arch !== "arm64",
  },
  async () => {
    const home = await mkdtemp(nodePath.join(tmpdir(), "pi-speech-setup-"));
    const env = {
      HOME: process.env.HOME,
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
    };
    let speech;
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
    let pendingInstall;
    const originals = {};
    const executions = [];
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
      install(signal) {
        executions.push({ signal });
        if (pendingInstall) {
          signal.addEventListener("abort", () => pendingInstall.resolve(), {
            once: true,
          });
          return pendingInstall.promise;
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
          started: Promise.resolve(),
        };
      },
      warm: () => Promise.resolve(),
    };
    for (const [name, method] of Object.entries(fake)) {
      originals[name] = LocalAudio.prototype[name];
      LocalAudio.prototype[name] = method;
    }
    const handlers = new Map();
    const commands = new Map();
    const shortcuts = new Map();
    const notices = [];
    const widgets = [];
    const branch = [];
    const context = {
      hasUI: true,
      isIdle: () => true,
      mode: "tui",
      sessionManager: {
        getBranch: () => branch,
        getLeafId: () => branch.at(-1)?.id,
      },
      ui: {
        confirm(title, message) {
          confirmations += 1;
          assert.match(title, /Set up read-aloud/u);
          for (const term of [
            "uv",
            "astral.sh",
            "Python 3.12",
            "dictionary",
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
        setWidget: (...args) => widgets.push(args),
      },
    };
    speech({
      on: (name, handler) => handlers.set(name, handler),
      registerCommand: (name, command) => commands.set(name, command),
      registerShortcut: (name, shortcut) => shortcuts.set(name, shortcut),
    });
    const event = (name, data = {}) => handlers.get(name)?.(data, context);
    const command = (args) => commands.get("speech").handler(args, context);
    const answer = async () => {
      await event("input", { source: "interactive" });
      await event("agent_start");
      branch.push({
        id: String(branch.length),
        message: {
          content: [{ text: "A completed answer.", type: "text" }],
          role: "assistant",
          stopReason: "stop",
        },
        type: "message",
      });
      await event("agent_settled");
      await tick();
    };
    try {
      await event("session_start");
      assert.equal(prompts, 1);
      assert.equal(executions.length, 0);
      assert.equal(confirmations, 0);
      assert.equal(checks, 1);
      assert.match(
        widgets.at(-1)[1]().render(200).join(" "),
        /setup needed.*auto inactive.*\/speech setup/u
      );
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
        assert.match(notices.at(-1)[0], /\/speech setup/u);
        assert.equal(notices.at(-1)[1], "info");
      }
      await shortcuts.get("ctrl+alt+s").handler(context);
      assert.equal(generated, 0);
      await event("session_shutdown");
      await event("session_start");
      assert.equal(prompts, 1, "Not now survives reopening Pi");
      assert.ok(
        commands
          .get("speech")
          .getArgumentCompletions("set")
          .some((item) => item.value === "setup")
      );
      await command("setup");
      assert.equal(confirmations, 1);
      assert.equal(executions.length, 0, "no installation without consent");
      consent = true;
      await command("setup");
      assert.equal(executions.length, 1);
      assert.match(
        notices.at(-1)[0],
        /did not finish.*Text responses still work[\s\S]*Network unavailable[\s\S]*\/speech setup/u
      );
      assert.equal(notices.at(-1)[1], "error");
      await answer();
      assert.equal(generated, 0);
      result = { code: 0, killed: false, stderr: "", stdout: "Complete." };
      await command("setup");
      assert.match(notices.at(-1)[0], /did not pass the readiness check/u);
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
        notices.at(-1)[0],
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
      await command("setup");
      assert.equal(
        executions.length,
        installs,
        "only one installer per session"
      );
      assert.match(notices.at(-1)[0], /already running/u);
      await event("session_shutdown");
      await running;
      assert.equal(executions.at(-1).signal.aborted, true);
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
      assert.match(notices.at(-1)[0], /Read-aloud is ready/u);
      assert.equal(generated, 2);
      await event("session_shutdown");
      const before = {
        checks,
        confirmations,
        executions: executions.length,
        prompts,
      };
      for await (const mode of ["rpc", "print", "json"]) {
        await handlers.get("session_start")({}, { mode });
        await commands.get("speech").handler("setup", { mode });
      }
      assert.deepEqual(
        { checks, confirmations, executions: executions.length, prompts },
        before
      );
    } finally {
      await event("session_shutdown");
      Object.assign(LocalAudio.prototype, originals);
      await rm(home, { force: true, recursive: true });
    }
  }
);

test("installer bootstraps missing prerequisites without real downloads and cancels its process group", async () => {
  const home = await mkdtemp(nodePath.join(tmpdir(), "pi setup shell "));
  const env = {
    FAIL_CHECK: process.env.FAIL_CHECK,
    HOME: process.env.HOME,
    PATH: process.env.PATH,
  };
  const script = (name, text) =>
    writeFile(nodePath.join(home, name), `#!/bin/sh\nset -eu\n${text}\n`, {
      mode: 0o700,
    });
  let audio;
  try {
    await mkdir(nodePath.join(home, "bin"));
    for await (const [name, path] of [
      ["sh", "/bin/sh"],
      ["rm", "/bin/rm"],
      ["dirname", "/usr/bin/dirname"],
      ["mktemp", "/usr/bin/mktemp"],
    ]) {
      await symlink(path, nodePath.join(home, "bin", name));
    }
    await script(
      "bin/uname",
      'if [ "$1" = -s ]; then echo Darwin; else echo arm64; fi'
    );
    await script(
      "bin/curl",
      'for target; do :; done\n/bin/cp "$HOME/fake-installer" "$target"'
    );
    await script(
      "fake-installer",
      'test "$UV_UNMANAGED_INSTALL" = "$HOME/.cache/pi-dyslexia/bin"\necho bootstrap >> "$HOME/log"\n/bin/mkdir -p "$UV_UNMANAGED_INSTALL"\n/bin/cp "$HOME/fake-uv" "$UV_UNMANAGED_INSTALL/uv"'
    );
    await script(
      "fake-uv",
      'printf "uv:%s\\n" "$*" >> "$HOME/log"\nif [ "$1" = venv ]; then\n/bin/mkdir -p "$HOME/.cache/pi-dyslexia/venv/bin"\n/bin/cp "$HOME/fake-python" "$HOME/.cache/pi-dyslexia/venv/bin/python"\nfi'
    );
    await script(
      "fake-python",
      `printf "python:%s\\n" "$*" >> "$HOME/log"\ncase "$*" in *--check*) exit "\${FAIL_CHECK:-0}" ;; esac`
    );
    await copyFile(
      new URL("../extensions/speech/audio.ts", import.meta.url),
      nodePath.join(home, "audio.ts")
    );
    await copyFile(
      new URL("../extensions/speech/async.ts", import.meta.url),
      nodePath.join(home, "async.ts")
    );
    await copyFile(
      new URL("../extensions/speech/setup.sh", import.meta.url),
      nodePath.join(home, "setup.sh")
    );
    process.env.HOME = home;
    process.env.PATH = nodePath.join(home, "bin");
    delete process.env.FAIL_CHECK;
    const { LocalAudio: IsolatedAudio } = await import(
      pathToFileURL(nodePath.join(home, "audio.ts"))
    );
    audio = new IsolatedAudio();
    assert.equal(
      await audio.checkReady(),
      false,
      "missing Python is a readiness state, not a thrown error"
    );
    await audio.install(new AbortController().signal);
    assert.equal(await audio.checkReady(), true);
    let log = await readFile(nodePath.join(home, "log"), "utf-8");
    assert.match(log, /bootstrap/u);
    assert.match(log, /uv:venv --python 3.12/u);
    assert.match(log, /uv:pip install --python/u);
    assert.match(log, /python:.*worker.py --download/u);
    assert.match(log, /python:.*worker.py --check/u);
    await audio.install(new AbortController().signal);
    log = await readFile(nodePath.join(home, "log"), "utf-8");
    assert.equal(
      log.match(/bootstrap/gu).length,
      1,
      "reuse the private uv installation"
    );
    assert.equal(
      log.match(/uv:venv/gu).length,
      1,
      "reuse the Python environment"
    );
    process.env.FAIL_CHECK = "1";
    assert.equal(
      await audio.checkReady(),
      false,
      "incomplete installations fail the offline check"
    );
    await assert.rejects(audio.install(new AbortController().signal));
    delete process.env.FAIL_CHECK;
    await script(
      "setup.sh",
      '/bin/sleep 60 &\necho "$!" > "$HOME/child.pid"\nwait'
    );
    const controller = new AbortController();
    const running = assert.rejects(audio.install(controller.signal));
    let pid;
    try {
      pid = await until(
        async () => {
          try {
            return Number(
              await readFile(nodePath.join(home, "child.pid"), "utf-8")
            );
          } catch (error) {
            if (error.code === "ENOENT") {
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
    assert.ok(pid, "the installer started a child process");
    await until(
      () => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (error) {
          if (error.code === "ESRCH") {
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
});
