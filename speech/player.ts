import { LocalAudio, type VoiceSettings } from "./audio.ts";
import { speechChunks } from "./text.ts";

export type Answer = { id: string; text: string };
export type SpeechState = "ready" | "loading" | "playing" | "paused" | "stopped" | "done" | "error";
type Prepared = { text: string; settings: string; result: Promise<{ path?: string; error?: unknown }> };

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
  private playbackStarted = false;
  private resumeWait?: () => void;
  private preparation?: AbortController;
  private prepared?: Prepared;
  private preparing = false;

  private audio: Pick<LocalAudio, "warm" | "generate" | "play" | "close">;
  private update: () => void;
  private reportError: (message: string) => void;

  constructor(audio: Pick<LocalAudio, "warm" | "generate" | "play" | "close">, update: () => void, reportError: (message: string) => void) {
    this.audio = audio;
    this.update = update;
    this.reportError = reportError;
  }

  get busy(): boolean {
    return ["loading", "playing", "paused"].includes(this.state);
  }

  /** Speculation is silent and bounded to one in-flight first chunk. */
  prepare(markdown?: string, complete = false): void {
    if (this.busy) return;
    if (!this.preparation) {
      this.preparation = new AbortController();
      // Foreground playback reports failures; background preparation never interrupts text.
      void this.audio.warm({ ...this.settings }, this.preparation.signal).catch(() => {});
    }
    if (markdown === undefined) { this.prepared = undefined; return; }
    const settings = { ...this.settings };
    const key = JSON.stringify([settings, this.includeAll]);
    if (!markdown || this.preparing || this.prepared?.settings === key) return;
    const chunks = speechChunks(markdown, this.includeAll);
    if (!chunks.length || (!complete && chunks.length < 2)) return;
    const text = chunks[0];
    const controller = this.preparation;
    this.preparing = true;
    this.prepared = {
      text, settings: key,
      result: this.audio.generate(text, settings, controller.signal)
        .then((path) => ({ path }), (error) => ({ error }))
        .finally(() => { if (this.preparation === controller) this.preparing = false; }),
    };
  }

  cancelPreparation(): void {
    this.preparation?.abort();
    this.preparation = undefined;
    this.prepared = undefined;
    this.preparing = false;
  }

  stop(): void {
    this.cancelPreparation();
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
      this.state = this.playback && this.playbackStarted ? "playing" : "loading";
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
    const controller = this.preparation ?? new AbortController();
    const prepared = this.prepared;
    // Transfer preparation to playback instead of aborting and reloading the model.
    this.preparation = undefined;
    this.stop();
    this.answer = answer;
    this.chunks = speechChunks(answer.text, this.includeAll);
    this.index = Math.max(0, Math.min(index, this.chunks.length - 1));
    if (!this.chunks.length) {
      controller.abort();
      this.state = "done";
      this.update();
      return;
    }
    this.signal = controller;
    this.state = "loading";
    this.update();
    this.finished = this.run(controller, prepared).catch((error) => {
      if (this.signal !== controller || controller.signal.aborted) return;
      controller.abort();
      this.playback = undefined;
      this.state = "error";
      this.reportError(error instanceof Error ? error.message : "Speech failed.");
      this.update();
    });
  }

  private async run(controller: AbortController, prepared?: Prepared): Promise<void> {
    const { signal } = controller;
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
        key = JSON.stringify([settings, this.includeAll]);
        const matches = prepared?.text === this.chunks[this.index] && prepared.settings === key;
        if (ready?.error && matches) throw ready.error;
        path = matches && ready?.path
          ? ready.path : await this.audio.generate(this.chunks[this.index], settings, signal);
        signal.throwIfAborted();
        await waitForResume();
      } while (key !== JSON.stringify([this.settings, this.includeAll]));
      const playback = this.audio.play(path, signal);
      this.playback = playback;
      this.playbackStarted = false;
      await playback.started;
      signal.throwIfAborted();
      this.playbackStarted = true;
      if ((this.state as SpeechState) !== "paused") this.state = "playing";
      this.update();
      const next = this.chunks[this.index + 1];
      prepared = next ? {
        text: next, settings: key,
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
