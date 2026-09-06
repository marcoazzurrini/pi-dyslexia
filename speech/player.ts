import { LocalAudio, type VoiceSettings } from "./audio.ts";
import { speechChunks } from "./text.ts";

export type Answer = { id: string; text: string };
export type SpeechState = "ready" | "loading" | "playing" | "paused" | "stopped" | "done" | "error";

export class SpeechPlayer {
  state: SpeechState = "ready";
  answer?: Answer;
  index = 0;
  chunks: string[] = [];
  settings: VoiceSettings = { voice: "af_heart", speed: 1 };
  includeAll = false;
  finished: Promise<void> = Promise.resolve();
  private signal?: AbortController;
  private playback?: ReturnType<LocalAudio["play"]>;
  private resumeWait?: () => void;

  private audio: Pick<LocalAudio, "generate" | "play" | "close">;
  private update: () => void;
  private reportError: (message: string) => void;

  constructor(audio: Pick<LocalAudio, "generate" | "play" | "close">, update: () => void, reportError: (message: string) => void) {
    this.audio = audio;
    this.update = update;
    this.reportError = reportError;
  }

  get busy(): boolean {
    return ["loading", "playing", "paused"].includes(this.state);
  }

  stop(): void {
    this.signal?.abort();
    this.signal = undefined;
    this.playback = undefined;
    this.resumeWait?.();
    this.resumeWait = undefined;
    this.state = "stopped";
    this.update();
  }

  toggle(): void {
    if (this.state === "paused") {
      this.playback?.resume();
      this.state = this.playback ? "playing" : "loading";
      this.resumeWait?.();
      this.resumeWait = undefined;
    } else if (this.busy) {
      this.playback?.pause();
      this.state = "paused";
    } else if (this.answer) {
      this.start(this.answer);
      return;
    }
    this.update();
  }

  start(answer: Answer, index = 0): void {
    this.stop();
    this.answer = answer;
    this.chunks = speechChunks(answer.text, this.includeAll);
    this.index = Math.max(0, Math.min(index, this.chunks.length - 1));
    if (!this.chunks.length) {
      this.state = "done";
      this.update();
      return;
    }
    const controller = new AbortController();
    this.signal = controller;
    this.state = "loading";
    this.update();
    this.finished = this.run(controller).catch((error) => {
      if (this.signal !== controller || controller.signal.aborted) return;
      controller.abort();
      this.playback = undefined;
      this.state = "error";
      this.reportError(error instanceof Error ? error.message : "Speech failed.");
      this.update();
    });
  }

  private async run(controller: AbortController): Promise<void> {
    const { signal } = controller;
    type Prepared = { settings: string; result: Promise<{ path?: string; error?: unknown }> };
    let prepared: Prepared | undefined;
    const waitForResume = async () => {
      if (this.state === "paused") await new Promise<void>((resolve) => { this.resumeWait = resolve; });
      signal.throwIfAborted();
    };
    for (; this.index < this.chunks.length; this.index++) {
      signal.throwIfAborted();
      await waitForResume();
      const ready = await prepared?.result;
      let settings: VoiceSettings;
      let key: string;
      let path: string;
      do {
        await waitForResume();
        settings = { ...this.settings };
        key = JSON.stringify(settings);
        if (ready?.error && prepared?.settings === key) throw ready.error;
        path = prepared?.settings === key && ready?.path
          ? ready.path : await this.audio.generate(this.chunks[this.index], settings, signal);
        signal.throwIfAborted();
        await waitForResume();
      } while (key !== JSON.stringify(this.settings));
      const playback = this.audio.play(path, signal);
      this.playback = playback;
      this.state = "playing";
      this.update();
      const next = this.chunks[this.index + 1];
      prepared = next ? {
        settings: key,
        // Observe rejection immediately, even if playback is stopped before the next sentence.
        result: this.audio.generate(next, settings, signal).then((path) => ({ path }), (error) => ({ error })),
      } : undefined;
      await playback.done;
      signal.throwIfAborted();
      this.playback = undefined;
      // Commands can change state while playback.done is pending.
      if ((this.state as SpeechState) !== "paused") this.state = "loading";
      this.update();
    }
    this.state = "done";
    this.update();
  }

  async close(): Promise<void> {
    this.stop();
    await this.audio.close();
    await this.finished;
  }
}
