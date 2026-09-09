import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { ignoreRejection } from "./async.ts";
import { LocalAudio } from "./audio.ts";
import type { Answer } from "./player.ts";
import { SpeechPlayer } from "./player.ts";

export const voices = [
  "af_heart",
  "af_bella",
  "am_michael",
  "bf_emma",
  "bm_george",
] as const;
const defaults = { auto: true, includeAll: false, speed: 1, voice: "af_heart" };
const configPath = path.join(getAgentDir(), "pi-dyslexia", "speech.json");
const legacyConfigPath = path.join(
  homedir(),
  ".config/pi-dyslexia/speech.json"
);
const setupPromptPath = path.join(
  path.dirname(configPath),
  "speech-setup-prompted"
);
type Settings = typeof defaults;
type CommandHandler = (value?: string) => void | Promise<void>;

const isSettings = (value: unknown): value is Settings => {
  if (!value || typeof value !== "object") {
    return false;
  }
  return (
    "auto" in value &&
    typeof value.auto === "boolean" &&
    "includeAll" in value &&
    typeof value.includeAll === "boolean" &&
    "speed" in value &&
    typeof value.speed === "number" &&
    Number.isFinite(value.speed) &&
    value.speed >= 0.5 &&
    value.speed <= 2 &&
    "voice" in value &&
    voices.some((voice) => voice === value.voice)
  );
};

export const parseSettings = (contents: string): Settings => {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new TypeError("Invalid speech settings JSON.", { cause: error });
  }
  if (!isSettings(value)) {
    throw new TypeError(
      "Invalid speech settings. Expected a known voice, speed 0.5–2, and boolean auto/includeAll."
    );
  }
  return {
    auto: value.auto,
    includeAll: value.includeAll,
    speed: value.speed,
    voice: value.voice,
  };
};

const isMissingFile = (cause: unknown): cause is NodeJS.ErrnoException =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

const readSettings = async (): Promise<Settings> => {
  let contents: string;
  try {
    contents = await readFile(configPath, "utf-8");
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
    contents = await readFile(legacyConfigPath, "utf-8");
  }
  return parseSettings(contents);
};

export const answerFromEntry = (
  entry: SessionEntry | undefined
): Answer | undefined => {
  if (
    entry?.type !== "message" ||
    entry.message.role !== "assistant" ||
    entry.message.stopReason !== "stop"
  ) {
    return;
  }
  if (entry.message.content.some((block) => block.type === "toolCall")) {
    return;
  }
  const text = entry.message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (text) {
    return { id: entry.id, text };
  }
};

export default function speech(pi: ExtensionAPI): void {
  // One player per Pi instance; independent windows retain independent playback.
  let ctx: ExtensionContext | undefined;
  let player: SpeechPlayer | undefined;
  let settings = { ...defaults };
  let latest: Answer | undefined;
  let runBoundary: string | null | undefined;
  let armed = false;
  let newer = false;
  let saving: Promise<void> = Promise.resolve();
  let ready = false;
  let autoBlocked = false;
  let setupTask: Promise<void> | undefined;
  let setupController: AbortController | undefined;
  let sessionController: AbortController | undefined;
  const commands = new Map<string, CommandHandler>();

  const notify = (message: string, type: "info" | "error" = "info") =>
    ctx?.ui.notify(message, type);
  const command = async (args: string): Promise<void> => {
    if (!ctx || !player) {
      return;
    }
    const [action = "", value, ...extra] = args.trim().split(/\s+/u);
    if (
      extra.length ||
      (value && !["auto", "speed", "voice", "include"].includes(action))
    ) {
      throw new Error("Use /speech help for controls.");
    }
    const handler = commands.get(action);
    if (!handler) {
      throw new Error("Unknown speech command. Use /speech help.");
    }
    await handler(value);
  };
  const execute = async (args: string): Promise<void> => {
    try {
      await command(args);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Speech command failed.",
        "error"
      );
    }
  };
  const automaticState = (): string => {
    if (!ready || setupTask) {
      return "inactive";
    }
    if (autoBlocked) {
      return "paused";
    }
    return settings.auto ? "on" : "off";
  };
  const playbackState = (): string => {
    if (setupTask) {
      return "setting up";
    }
    if (!ready) {
      return "setup needed";
    }
    return player?.state ?? "stopped";
  };
  const reportError = (message: string) => {
    autoBlocked = true;
    notify(
      `${message}\nAutomatic read-aloud is paused for this session. Text responses still work.`,
      "error"
    );
  };
  const update = () => {
    if (!ctx || !player) {
      return;
    }
    let primary = "Play";
    if (player.busy) {
      primary = player.state === "paused" ? "Resume" : "Pause";
    }
    const actions = [primary, "Replay", "Stop", "Previous"];
    const controls = actions.map((name) => `[${name}]`).join(" ");
    const label = `Speech: ${playbackState()} | ${settings.speed}x | auto ${automaticState()}${newer ? " | newer answer: /speech latest" : ""}`;
    let description = `${controls}  /speech${settings.includeAll ? " | includes code/URLs" : " | skips code/URLs (announced)"}`;
    if (setupTask) {
      description = "Downloading and installing. Text responses still work.";
    } else if (!ready) {
      description =
        "Text responses work. Use /speech setup to enable read-aloud.";
    }
    ctx.ui.setWidget("dyslexia-speech", () => ({
      handleMouse(event) {
        if (
          !ready ||
          setupTask ||
          event.type !== "click" ||
          event.button !== "left" ||
          event.y !== 1
        ) {
          return;
        }
        let x = 0;
        for (const [index, action] of actions.entries()) {
          const end = x + action.length + 2;
          if (event.x >= x && event.x < end) {
            void execute(["", "replay", "stop", "previous"][index]);
            return { handled: true };
          }
          x = end + 1;
        }
      },
      invalidate() {
        // This widget renders immutable strings and has no cached layout to invalidate.
      },
      render: (width: number) => [
        label.slice(0, width),
        description.slice(0, width),
      ],
    }));
  };
  const createPlayer = () => {
    const result = new SpeechPlayer(new LocalAudio(), update, reportError);
    result.settings = { speed: settings.speed, voice: settings.voice };
    result.includeAll = settings.includeAll;
    return result;
  };
  const branchAnswers = () =>
    ctx?.sessionManager
      .getBranch()
      .map(answerFromEntry)
      .filter((answer): answer is Answer => !!answer) ?? [];
  const readLatest = () => {
    latest = branchAnswers().at(-1);
    newer = false;
  };
  const select = (answer: Answer | undefined, index = 0) => {
    if (!ready || setupTask) {
      notify(
        setupTask
          ? "Read-aloud setup is running."
          : "Read-aloud needs setup. Use /speech setup in Pi. Text responses still work."
      );
      return;
    }
    if (!answer || !player) {
      notify("No completed answer to read.");
      return;
    }
    newer = !!latest && answer.id !== latest.id;
    player.start(answer, index);
  };
  const save = async (patch: Partial<Settings>) => {
    const previous = saving;
    const persist = async () => {
      await previous;
      const next = parseSettings(JSON.stringify({ ...settings, ...patch }));
      await mkdir(path.dirname(configPath), { mode: 0o700, recursive: true });
      const temporary = `${configPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
          mode: 0o600,
        });
        await rename(temporary, configPath);
      } finally {
        await rm(temporary, { force: true });
      }
      settings = next;
      if (player) {
        player.settings = { speed: next.speed, voice: next.voice };
        player.includeAll = next.includeAll;
      }
      update();
    };
    const pending = persist();
    saving = ignoreRejection(pending);
    await pending;
  };
  const setup = async (): Promise<void> => {
    if (setupTask) {
      notify("Read-aloud setup is already running.");
      return;
    }
    const context = ctx;
    if (!context) {
      return;
    }
    const controller = new AbortController();
    setupController = controller;
    const install = async () => {
      try {
        const consent = await context.ui.confirm(
          "Set up read-aloud?",
          "This downloads and runs uv from astral.sh if needed, and installs Python 3.12, speech dependencies, the English dictionary, and the Kokoro voice model.\nInternet access and disk space are required. Setup may take several minutes. No administrator access or shell profile changes.\nAfter setup, narration stays local. No audio plays during setup.",
          { signal: controller.signal }
        );
        if (!consent || controller.signal.aborted || ctx !== context) {
          return;
        }
        ready = false;
        await player?.close();
        if (controller.signal.aborted || ctx !== context) {
          return;
        }
        player = createPlayer();
        update();
        notify(
          "Setting up read-aloud. Downloading and installing may take several minutes. Text responses still work."
        );
        const audio = new LocalAudio();
        await audio.install(controller.signal);
        if (controller.signal.aborted || ctx !== context) {
          return;
        }
        const installed = await audio.checkReady(controller.signal);
        if (controller.signal.aborted || ctx !== context) {
          return;
        }
        ready = installed;
        if (!ready) {
          throw new Error(
            "The downloaded speech files did not pass the readiness check."
          );
        }
        autoBlocked = false;
        notify(
          `Read-aloud is ready. Use /speech preview to try it. Automatic narration is ${settings.auto ? "on for future answers" : "off"}.`
        );
      } catch (error) {
        if (!controller.signal.aborted && ctx === context) {
          notify(
            `Read-aloud setup did not finish. Text responses still work.\n${error instanceof Error ? error.message : "Setup failed."}\nUse /speech setup to retry.`,
            "error"
          );
        }
      } finally {
        setupTask = undefined;
        setupController = undefined;
        if (ctx === context) {
          update();
        }
      }
    };
    setupTask = install();
    await setupTask;
  };

  commands.set("setup", setup);
  commands.set("", () => {
    if (player?.busy) {
      player.toggle();
    } else {
      select(player?.answer ?? latest);
    }
  });
  commands.set("latest", () => select(latest));
  commands.set("replay", () => select(player?.answer ?? latest));
  commands.set("previous", () =>
    select(player?.answer ?? latest, (player?.index ?? 0) - 1)
  );
  commands.set("stop", () => {
    armed = false;
    player?.stop();
  });
  commands.set("off", async () => {
    const old = player;
    await save({ auto: false });
    if (!old || player !== old || !ctx) {
      return;
    }
    player = undefined;
    await old.close();
    if (!ctx) {
      return;
    }
    player = createPlayer();
    update();
  });
  commands.set("auto", async (value) => {
    if (value !== "on" && value !== "off") {
      throw new Error("Usage: /speech auto on|off");
    }
    await save({ auto: value === "on" });
    if (value === "off") {
      player?.cancelPreparation();
    }
    autoBlocked = false;
    update();
    notify(
      ready
        ? `Automatic speech ${value}. Applies to future completed answers.`
        : `Automatic speech preference saved: ${value}. Read-aloud stays inactive until you complete /speech setup.`
    );
  });
  commands.set("speed", async (value) => {
    const speed = Number(value);
    if (!value || !Number.isFinite(speed) || speed < 0.5 || speed > 2) {
      throw new Error("Usage: /speech speed 0.5–2");
    }
    await save({ speed });
  });
  commands.set("voice", async (value) => {
    const voice =
      value ?? (await ctx?.ui.select("Speech voice (English)", [...voices]));
    if (!voice) {
      return;
    }
    await save({ voice });
    notify(`Voice: ${voice}. Use /speech preview to hear it.`);
  });
  commands.set("preview", () =>
    select({
      id: "preview",
      text: "This is your reading voice. You can pause, stop, or replay any answer.",
    })
  );
  commands.set("include", async (value) => {
    if (value !== "all" && value !== "prose") {
      throw new Error("Usage: /speech include all|prose");
    }
    player?.stop();
    await save({ includeAll: value === "all" });
    notify("Speech content setting saved. Replay to apply it.");
  });
  commands.set("answers", async () => {
    const answers = branchAnswers().toReversed();
    const labels = answers.map(
      (answer, index) =>
        `${index + 1}. ${answer.text.replaceAll(/\s+/gu, " ").slice(0, 90)}`
    );
    if (!labels.length) {
      notify("No completed answers.");
      return;
    }
    const chosen = await ctx?.ui.select("Read an answer", labels);
    if (chosen) {
      select(answers[labels.indexOf(chosen)]);
    }
  });
  commands.set("status", () => {
    const state =
      ready || setupTask ? playbackState() : "setup needed (/speech setup)";
    notify(
      `Speech: ${state}; auto ${automaticState()}; ${settings.voice}; ${settings.speed}x. Settings: ${configPath}`
    );
  });
  commands.set("help", () =>
    notify(
      "/speech setup: install or repair local read-aloud with your permission.\n/speech [latest|replay|previous|stop|off|answers|preview|status]\n/speech auto on|off; speed 0.5–2; voice [preset]; include all|prose\nCtrl+Alt+S: play/pause. Ctrl+Alt+R: replay. Ctrl+Alt+X: stop.\nClick controls in fullscreen mode. Speech supports English on Apple Silicon macOS."
    )
  );

  pi.registerCommand("speech", {
    description:
      "Local narration: setup, play/pause, replay, stop, auto, speed, voice, answers, help",
    getArgumentCompletions: (prefix) =>
      [
        "setup",
        "latest",
        "replay",
        "previous",
        "stop",
        "off",
        "answers",
        "preview",
        "status",
        "help",
        "auto on",
        "auto off",
        "speed 1.25",
        "speed 1.5",
        "voice",
        "include all",
        "include prose",
      ]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ label: value, value })),
    handler: async (args, context) => {
      if (context.mode !== "tui") {
        return;
      }
      if (process.platform !== "darwin" || process.arch !== "arm64") {
        context.ui.notify(
          "Read-aloud currently requires an Apple Silicon Mac. Text responses still work.",
          "info"
        );
        return;
      }
      await execute(args);
    },
  });
  for (const [shortcut, action] of [
    ["ctrl+alt+s", ""],
    ["ctrl+alt+r", "replay"],
    ["ctrl+alt+x", "stop"],
  ] as const) {
    pi.registerShortcut(shortcut, {
      description: `Speech ${action || "play/pause"}`,
      handler: async (context) => {
        if (context.mode === "tui") {
          await execute(action);
        }
      },
    });
  }
  pi.on("session_start", async (_event, context) => {
    if (context.mode !== "tui") {
      return;
    }
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      context.ui.notify(
        "Speech currently requires an Apple Silicon Mac.",
        "info"
      );
      return;
    }
    ctx = context;
    const controller = new AbortController();
    sessionController = controller;
    const installed = await new LocalAudio().checkReady(controller.signal);
    if (controller.signal.aborted || ctx !== context) {
      return;
    }
    ready = installed;
    autoBlocked = false;
    settings = { ...defaults };
    try {
      settings = await readSettings();
    } catch (error) {
      if (!isMissingFile(error)) {
        settings.auto = false;
        notify(
          "Cannot read speech settings; using manual playback defaults.",
          "error"
        );
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
        if (!isMissingFile(error)) {
          notify(
            "Read-aloud needs setup. Use /speech setup when you want to enable it."
          );
          return;
        }
      }
      const choice = await context.ui.select(
        "Read-aloud needs a one-time download. Text responses already work.",
        ["Set up read-aloud", "Not now"],
        { signal: controller.signal }
      );
      if (controller.signal.aborted || ctx !== context) {
        return;
      }
      try {
        await mkdir(path.dirname(setupPromptPath), {
          mode: 0o700,
          recursive: true,
        });
        await writeFile(setupPromptPath, "", { mode: 0o600 });
      } catch {
        notify(
          "Could not remember your setup choice. The prompt may appear again next time."
        );
      }
      if (choice === "Set up read-aloud") {
        await setup();
      }
    }
  });
  pi.on("input", (event) => {
    if (event.source === "interactive") {
      player?.stop();
    }
  });
  const canPrepare = (context: ExtensionContext) =>
    context.mode === "tui" &&
    armed &&
    ready &&
    !setupTask &&
    !autoBlocked &&
    settings.auto;
  const prepareMessage = (
    message: MessageEndEvent["message"],
    complete: boolean,
    context: ExtensionContext
  ) => {
    if (
      !canPrepare(context) ||
      message.role !== "assistant" ||
      (complete && message.stopReason !== "stop") ||
      message.content.some((block) => block.type === "toolCall")
    ) {
      return;
    }
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    player?.prepare(text, complete);
  };
  pi.on("agent_start", (_event, context) => {
    if (context.mode !== "tui") {
      return;
    }
    runBoundary = context.sessionManager.getLeafId();
    armed = true;
    if (canPrepare(context)) {
      player?.prepare();
    }
  });
  pi.on("message_start", (event, context) => {
    if (canPrepare(context) && event.message.role === "assistant") {
      player?.prepare();
    }
  });
  pi.on("message_update", (event, context) =>
    prepareMessage(event.message, false, context)
  );
  pi.on("message_end", (event, context) =>
    prepareMessage(event.message, true, context)
  );
  pi.on("agent_settled", (_event, context) => {
    if (context.mode !== "tui" || !player || !armed || !context.isIdle()) {
      return;
    }
    armed = false;
    const branch = context.sessionManager.getBranch();
    const hasBoundary = runBoundary !== null && runBoundary !== undefined;
    const boundary = hasBoundary
      ? branch.findIndex((entry) => entry.id === runBoundary)
      : -1;
    if (hasBoundary && boundary < 0) {
      player.cancelPreparation();
      return;
    }
    const lastAssistant = branch
      .slice(boundary + 1)
      .findLast(
        (entry) =>
          entry.type === "message" && entry.message.role === "assistant"
      );
    const answer = answerFromEntry(lastAssistant);
    if (!answer || answer.id === latest?.id) {
      player.cancelPreparation();
      return;
    }
    latest = answer;
    newer = !!player.answer && player.answer.id !== answer.id;
    if (ready && !setupTask && !autoBlocked && settings.auto && !player.busy) {
      select(answer);
    } else {
      player.cancelPreparation();
      update();
    }
  });
  pi.on("session_tree", () => {
    armed = false;
    player?.stop();
    if (player) {
      player.answer = undefined;
      player.chunks = [];
    }
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
