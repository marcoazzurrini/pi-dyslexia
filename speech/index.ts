import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { LocalAudio } from "./audio.ts";
import { SpeechPlayer, type Answer } from "./player.ts";

export const voices = ["af_heart", "af_bella", "am_michael", "bf_emma", "bm_george"] as const;
const defaults = { auto: true, speed: 1, voice: "af_heart", includeAll: false };
const configPath = join(homedir(), ".config/pi-dyslexia/speech.json");
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

  const notify = (message: string, type: "info" | "error" = "info") => ctx?.ui.notify(message, type);
  const update = () => {
    if (!ctx || !player) return;
    const p = player;
    const actions = [p.busy ? (p.state === "paused" ? "Resume" : "Pause") : "Play", "Replay", "Stop", "Previous"];
    const controls = actions.map((name) => `[${name}]`).join(" ");
    const label = `Speech: ${p.state} | ${settings.speed}x | auto ${settings.auto ? "on" : "off"}${newer ? " | newer answer: /speech latest" : ""}`;
    ctx.ui.setWidget("dyslexia-speech", () => ({
      render: (width: number) => [label.slice(0, width), `${controls}  /speech${settings.includeAll ? " | includes code/URLs" : " | skips code/URLs (announced)"}`.slice(0, width)],
      invalidate() {},
      handleMouse(event) {
        if (event.type !== "click" || event.button !== "left" || event.y !== 1) return;
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

  const branchAnswers = () => ctx?.sessionManager.getBranch().map(answerFromEntry).filter((a): a is Answer => !!a) ?? [];
  const readLatest = () => {
    latest = branchAnswers().at(-1);
    newer = false;
  };
  const select = (answer: Answer | undefined, index = 0) => {
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

  async function command(args: string): Promise<void> {
    if (!ctx || !player) return;
    const [action = "", value, ...extra] = args.trim().split(/\s+/);
    if (extra.length) throw new Error("Use /speech help for controls.");
    if (!["auto", "speed", "voice", "include"].includes(action) && value) throw new Error("Use /speech help for controls.");
    switch (action) {
      case "":
        if (player.busy) player.toggle();
        else select(player.answer ?? latest);
        break;
      case "latest": select(latest); break;
      case "replay": select(player.answer ?? latest); break;
      case "previous": select(player.answer ?? latest, player.index - 1); break;
      case "stop": player.stop(); break;
      case "off": {
        const old = player;
        await save({ auto: false });
        if (player !== old || !ctx) return;
        player = undefined;
        await old.close();
        if (!ctx) return;
        player = new SpeechPlayer(new LocalAudio(), update, (message) => notify(message, "error"));
        player.settings = { voice: settings.voice, speed: settings.speed };
        player.includeAll = settings.includeAll;
        update();
        break;
      }
      case "auto":
        if (value !== "on" && value !== "off") throw new Error("Usage: /speech auto on|off");
        await save({ auto: value === "on" });
        notify(`Automatic speech ${value}. Applies to future completed answers.`);
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
      case "status": notify(`Speech: ${player.state}; auto ${settings.auto ? "on" : "off"}; ${settings.voice}; ${settings.speed}x. Settings: ${configPath}`); break;
      case "help":
        notify("/speech [latest|replay|previous|stop|off|answers|preview|status]\n/speech auto on|off; speed 0.5–2; voice [preset]; include all|prose\nCtrl+Alt+S: play/pause. Ctrl+Alt+R: replay. Ctrl+Alt+X: stop.\nClick controls in fullscreen mode. Speech supports English on Apple Silicon macOS.");
        break;
      default: throw new Error("Unknown speech command. Use /speech help.");
    }
  }

  pi.registerCommand("speech", {
    description: "Local narration: play/pause, replay, stop, auto, speed, voice, answers, help",
    getArgumentCompletions: (prefix) => ["latest", "replay", "previous", "stop", "off", "answers", "preview", "status", "help", "auto on", "auto off", "speed 1.25", "speed 1.5", "voice", "include all", "include prose"]
      .filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
    handler: async (args, context) => {
      if (context.mode !== "tui") return;
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
    settings = { ...defaults };
    try { settings = validateSettings(JSON.parse(await readFile(configPath, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        settings.auto = false;
        notify("Cannot read speech settings; using manual playback defaults.", "error");
      }
    }
    player = new SpeechPlayer(new LocalAudio(), update, (message) => notify(message, "error"));
    player.settings = { voice: settings.voice, speed: settings.speed };
    player.includeAll = settings.includeAll;
    armed = false;
    readLatest();
    update();
  });
  pi.on("input", (event) => {
    if (event.source === "interactive") player?.stop();
  });
  pi.on("agent_start", (_event, context) => {
    if (context.mode !== "tui") return;
    runBoundary = context.sessionManager.getLeafId();
    armed = true;
  });
  pi.on("agent_settled", (_event, context) => {
    if (context.mode !== "tui" || !player || !armed || !context.isIdle()) return;
    armed = false;
    const branch = context.sessionManager.getBranch();
    const boundary = runBoundary == null ? -1 : branch.findIndex((entry) => entry.id === runBoundary);
    if (runBoundary != null && boundary < 0) return;
    const lastAssistant = branch.slice(boundary + 1).findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
    const answer = answerFromEntry(lastAssistant);
    if (!answer || answer.id === latest?.id) return;
    latest = answer;
    newer = !!player.answer && player.answer.id !== answer.id;
    if (settings.auto && !player.busy) select(answer);
    else update();
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
    await old?.close();
    await saving;
  });
}
