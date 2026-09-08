import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext, type MessageEndEvent, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { LocalAudio } from "./audio.ts";
import { SpeechPlayer, type Answer } from "./player.ts";

export const voices = ["af_heart", "af_bella", "am_michael", "bf_emma", "bm_george"] as const;
const defaults = { auto: true, speed: 1, voice: "af_heart", includeAll: false };
const configPath = join(getAgentDir(), "pi-dyslexia", "speech.json");
const legacyConfigPath = join(homedir(), ".config/pi-dyslexia/speech.json");
const setupPromptPath = join(dirname(configPath), "speech-setup-prompted");
type Settings = typeof defaults;

export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== "object") throw new Error("Invalid speech settings.");
  const s = value as Settings;
  if (typeof s.auto !== "boolean" || typeof s.includeAll !== "boolean" ||
      !Number.isFinite(s.speed) || s.speed < 0.5 || s.speed > 2 || !voices.includes(s.voice as typeof voices[number])) {
    throw new Error("Invalid speech settings. Expected a known voice, speed 0.5–2, and boolean auto/includeAll.");
  }
  return { auto: s.auto, speed: s.speed, voice: s.voice, includeAll: s.includeAll };
}

export function answerFromEntry(entry: SessionEntry | undefined): Answer | undefined {
  if (entry?.type !== "message" || entry.message.role !== "assistant" || entry.message.stopReason !== "stop") return;
  if (entry.message.content.some((block) => block.type === "toolCall")) return;
  const text = entry.message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
  if (text) return { id: entry.id, text };
}

export default function speech(pi: ExtensionAPI): void {
  // ponytail: one player per Pi instance; add shared audio ownership if multiple windows need coordinated narration.
  let ctx: ExtensionContext | undefined;
  let player: SpeechPlayer | undefined;
  let settings = { ...defaults };
  let latest: Answer | undefined;
  let runBoundary: string | null | undefined;
  let armed = false;
  let newer = false;
  let saving = Promise.resolve();
  let ready = false;
  let autoBlocked = false;
  let setupTask: Promise<void> | undefined;
  let setupController: AbortController | undefined;
  let sessionController: AbortController | undefined;

  const notify = (message: string, type: "info" | "error" = "info") => ctx?.ui.notify(message, type);
  const reportError = (message: string) => {
    autoBlocked = true;
    notify(`${message}\nAutomatic read-aloud is paused for this session. Text responses still work.`, "error");
  };
  const update = () => {
    if (!ctx || !player) return;
    const p = player;
    const actions = [p.busy ? (p.state === "paused" ? "Resume" : "Pause") : "Play", "Replay", "Stop", "Previous"];
    const controls = actions.map((name) => `[${name}]`).join(" ");
    const state = setupTask ? "setting up" : !ready ? "setup needed" : p.state;
    const label = `Speech: ${state} | ${settings.speed}x | auto ${!ready || setupTask ? "inactive" : autoBlocked ? "paused" : settings.auto ? "on" : "off"}${newer ? " | newer answer: /speech latest" : ""}`;
    ctx.ui.setWidget("dyslexia-speech", () => ({
      render: (width: number) => [label.slice(0, width), (setupTask ? "Downloading and installing. Text responses still work."
        : !ready ? "Text responses work. Use /speech setup to enable read-aloud."
        : `${controls}  /speech${settings.includeAll ? " | includes code/URLs" : " | skips code/URLs (announced)"}`).slice(0, width)],
      invalidate() {},
      handleMouse(event) {
        if (!ready || setupTask || event.type !== "click" || event.button !== "left" || event.y !== 1) return;
        let x = 0;
        for (let i = 0; i < actions.length; i++) {
          const end = x + actions[i].length + 2;
          if (event.x >= x && event.x < end) {
            void command(["", "replay", "stop", "previous"][i]).catch((error) => notify(error.message, "error"));
            return { handled: true };
          }
          x = end + 1;
        }
      },
    }));
  };

  const createPlayer = () => {
    const p = new SpeechPlayer(new LocalAudio(), update, reportError);
    p.settings = { voice: settings.voice, speed: settings.speed };
    p.includeAll = settings.includeAll;
    return p;
  };

  const branchAnswers = () => ctx?.sessionManager.getBranch().map(answerFromEntry).filter((a): a is Answer => !!a) ?? [];
  const readLatest = () => {
    latest = branchAnswers().at(-1);
    newer = false;
  };
  const select = (answer: Answer | undefined, index = 0) => {
    if (!ready || setupTask) { notify(setupTask ? "Read-aloud setup is running." : "Read-aloud needs setup. Use /speech setup in Pi. Text responses still work."); return; }
    if (!answer || !player) { notify("No completed answer to read."); return; }
    newer = !!latest && answer.id !== latest.id;
    player.start(answer, index);
  };
  const save = async (patch: Partial<Settings>) => {
    const pending = saving.then(async () => {
      const next = validateSettings({ ...settings, ...patch });
      await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
      const temporary = `${configPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
        await rename(temporary, configPath);
      } finally {
        await rm(temporary, { force: true });
      }
      settings = next;
      if (player) { player.settings = { voice: next.voice, speed: next.speed }; player.includeAll = next.includeAll; }
      update();
    });
    saving = pending.catch(() => {});
    await pending;
  };

  async function setup(): Promise<void> {
    if (setupTask) { notify("Read-aloud setup is already running."); return; }
    const context = ctx;
    if (!context) return;
    const controller = new AbortController();
    setupController = controller;
    setupTask = (async () => {
      const consent = await context.ui.confirm("Set up read-aloud?",
        "This downloads and runs uv from astral.sh if needed, and installs Python 3.12, speech dependencies, the English dictionary, and the Kokoro voice model.\nInternet access and disk space are required. Setup may take several minutes. No administrator access or shell profile changes.\nAfter setup, narration stays local. No audio plays during setup.",
        { signal: controller.signal });
      if (!consent || controller.signal.aborted || ctx !== context) return;
      ready = false;
      await player?.close();
      if (controller.signal.aborted || ctx !== context) return;
      player = createPlayer();
      update();
      notify("Setting up read-aloud. Downloading and installing may take several minutes. Text responses still work.");
      const audio = new LocalAudio();
      await audio.install(controller.signal);
      if (controller.signal.aborted || ctx !== context) return;
      const installed = await audio.checkReady(controller.signal);
      if (controller.signal.aborted || ctx !== context) return;
      ready = installed;
      if (!ready) throw new Error("The downloaded speech files did not pass the readiness check.");
      autoBlocked = false;
      notify(`Read-aloud is ready. Use /speech preview to try it. Automatic narration is ${settings.auto ? "on for future answers" : "off"}.`);
    })().catch((error) => {
      if (!controller.signal.aborted && ctx === context) {
        notify(`Read-aloud setup did not finish. Text responses still work.\n${error instanceof Error ? error.message : "Setup failed."}\nUse /speech setup to retry.`, "error");
      }
    }).finally(() => {
      setupTask = undefined;
      setupController = undefined;
      if (ctx === context) update();
    });
    await setupTask;
  }

  async function command(args: string): Promise<void> {
    if (!ctx || !player) return;
    const [action = "", value, ...extra] = args.trim().split(/\s+/);
    if (extra.length) throw new Error("Use /speech help for controls.");
    if (!["auto", "speed", "voice", "include"].includes(action) && value) throw new Error("Use /speech help for controls.");
    switch (action) {
      case "setup": await setup(); break;
      case "":
        if (player.busy) player.toggle();
        else select(player.answer ?? latest);
        break;
      case "latest": select(latest); break;
      case "replay": select(player.answer ?? latest); break;
      case "previous": select(player.answer ?? latest, player.index - 1); break;
      case "stop": armed = false; player.stop(); break;
      case "off": {
        const old = player;
        await save({ auto: false });
        if (player !== old || !ctx) return;
        player = undefined;
        await old.close();
        if (!ctx) return;
        player = createPlayer();
        update();
        break;
      }
      case "auto":
        if (value !== "on" && value !== "off") throw new Error("Usage: /speech auto on|off");
        await save({ auto: value === "on" });
        if (value === "off") player?.cancelPreparation();
        autoBlocked = false;
        update();
        notify(ready ? `Automatic speech ${value}. Applies to future completed answers.` : `Automatic speech preference saved: ${value}. Read-aloud stays inactive until you complete /speech setup.`);
        break;
      case "speed":
        if (!value || !Number.isFinite(Number(value)) || Number(value) < 0.5 || Number(value) > 2) throw new Error("Usage: /speech speed 0.5–2");
        await save({ speed: Number(value) });
        break;
      case "voice": {
        const voice = value ?? await ctx.ui.select("Speech voice (English)", [...voices]);
        if (!voice) return;
        await save({ voice });
        notify(`Voice: ${voice}. Use /speech preview to hear it.`);
        break;
      }
      case "preview": select({ id: "preview", text: "This is your reading voice. You can pause, stop, or replay any answer." }); break;
      case "include":
        if (value !== "all" && value !== "prose") throw new Error("Usage: /speech include all|prose");
        player.stop();
        await save({ includeAll: value === "all" });
        notify("Speech content setting saved. Replay to apply it.");
        break;
      case "answers": {
        const answers = branchAnswers().reverse();
        const labels = answers.map((a, i) => `${i + 1}. ${a.text.replace(/\s+/g, " ").slice(0, 90)}`);
        if (!labels.length) { notify("No completed answers."); return; }
        const chosen = await ctx.ui.select("Read an answer", labels);
        if (chosen) select(answers[labels.indexOf(chosen)]);
        break;
      }
      case "status": notify(`Speech: ${setupTask ? "setting up" : ready ? player.state : "setup needed (/speech setup)"}; auto ${!ready || setupTask ? "inactive" : autoBlocked ? "paused" : settings.auto ? "on" : "off"}; ${settings.voice}; ${settings.speed}x. Settings: ${configPath}`); break;
      case "help":
        notify("/speech setup: install or repair local read-aloud with your permission.\n/speech [latest|replay|previous|stop|off|answers|preview|status]\n/speech auto on|off; speed 0.5–2; voice [preset]; include all|prose\nCtrl+Alt+S: play/pause. Ctrl+Alt+R: replay. Ctrl+Alt+X: stop.\nClick controls in fullscreen mode. Speech supports English on Apple Silicon macOS.");
        break;
      default: throw new Error("Unknown speech command. Use /speech help.");
    }
  }

  pi.registerCommand("speech", {
    description: "Local narration: setup, play/pause, replay, stop, auto, speed, voice, answers, help",
    getArgumentCompletions: (prefix) => ["setup", "latest", "replay", "previous", "stop", "off", "answers", "preview", "status", "help", "auto on", "auto off", "speed 1.25", "speed 1.5", "voice", "include all", "include prose"]
      .filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
    handler: async (args, context) => {
      if (context.mode !== "tui") return;
      if (process.platform !== "darwin" || process.arch !== "arm64") {
        context.ui.notify("Read-aloud currently requires an Apple Silicon Mac. Text responses still work.", "info");
        return;
      }
      try { await command(args); } catch (error) { notify(error instanceof Error ? error.message : "Speech command failed.", "error"); }
    },
  });
  for (const [shortcut, action] of [["ctrl+alt+s", ""], ["ctrl+alt+r", "replay"], ["ctrl+alt+x", "stop"]] as const) {
    pi.registerShortcut(shortcut, {
      description: `Speech ${action || "play/pause"}`,
      handler: async (context) => {
        if (context.mode === "tui") await command(action).catch((error) => notify(error.message, "error"));
      },
    });
  }
  pi.on("session_start", async (_event, context) => {
    if (context.mode !== "tui") return;
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      context.ui.notify("Speech currently requires an Apple Silicon Mac.", "info");
      return;
    }
    ctx = context;
    const controller = new AbortController();
    sessionController = controller;
    const installed = await new LocalAudio().checkReady(controller.signal);
    if (controller.signal.aborted || ctx !== context) return;
    ready = installed;
    autoBlocked = false;
    settings = { ...defaults };
    try {
      const contents = await readFile(configPath, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return readFile(legacyConfigPath, "utf8");
      });
      settings = validateSettings(JSON.parse(contents));
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        settings.auto = false;
        notify("Cannot read speech settings; using manual playback defaults.", "error");
      }
    }
    player = createPlayer();
    armed = false;
    readLatest();
    update();
    if (!ready) {
      try {
        await readFile(setupPromptPath);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          notify("Read-aloud needs setup. Use /speech setup when you want to enable it.");
          return;
        }
      }
      const choice = await context.ui.select("Read-aloud needs a one-time download. Text responses already work.", ["Set up read-aloud", "Not now"], { signal: controller.signal });
      if (controller.signal.aborted || ctx !== context) return;
      try {
        await mkdir(dirname(setupPromptPath), { recursive: true, mode: 0o700 });
        await writeFile(setupPromptPath, "", { mode: 0o600 });
      } catch {
        notify("Could not remember your setup choice. The prompt may appear again next time.");
      }
      if (choice === "Set up read-aloud") await setup();
    }
  });
  pi.on("input", (event) => {
    if (event.source === "interactive") player?.stop();
  });
  const canPrepare = (context: ExtensionContext) => context.mode === "tui" && armed && ready && !setupTask && !autoBlocked && settings.auto;
  const prepareMessage = (message: MessageEndEvent["message"], complete: boolean, context: ExtensionContext) => {
    if (!canPrepare(context) || message.role !== "assistant" ||
        (complete && message.stopReason !== "stop") || message.content.some((block) => block.type === "toolCall")) return;
    const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
    player?.prepare(text, complete);
  };
  pi.on("agent_start", (_event, context) => {
    if (context.mode !== "tui") return;
    runBoundary = context.sessionManager.getLeafId();
    armed = true;
    if (canPrepare(context)) player?.prepare();
  });
  pi.on("message_start", (event, context) => {
    if (canPrepare(context) && event.message.role === "assistant") player?.prepare();
  });
  pi.on("message_update", (event, context) => prepareMessage(event.message, false, context));
  pi.on("message_end", (event, context) => prepareMessage(event.message, true, context));
  pi.on("agent_settled", (_event, context) => {
    if (context.mode !== "tui" || !player || !armed || !context.isIdle()) return;
    armed = false;
    const branch = context.sessionManager.getBranch();
    const boundary = runBoundary == null ? -1 : branch.findIndex((entry) => entry.id === runBoundary);
    if (runBoundary != null && boundary < 0) { player.cancelPreparation(); return; }
    const lastAssistant = branch.slice(boundary + 1).findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
    const answer = answerFromEntry(lastAssistant);
    if (!answer || answer.id === latest?.id) { player.cancelPreparation(); return; }
    latest = answer;
    newer = !!player.answer && player.answer.id !== answer.id;
    if (ready && !setupTask && !autoBlocked && settings.auto && !player.busy) select(answer);
    else { player.cancelPreparation(); update(); }
  });
  pi.on("session_tree", () => {
    armed = false;
    player?.stop();
    if (player) { player.answer = undefined; player.chunks = []; }
    readLatest();
    update();
  });
  pi.on("session_shutdown", async () => {
    const old = player;
    ctx = undefined;
    player = undefined;
    armed = false;
    ready = false;
    sessionController?.abort();
    sessionController = undefined;
    setupController?.abort();
    await setupTask;
    await old?.close();
    await saving;
  });
}
