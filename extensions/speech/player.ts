import { captureGeneration, ignoreRejection } from "./async.ts";
import type { LocalAudio, VoiceSettings } from "./audio.ts";
import { speechChunks } from "./text.ts";

export interface Answer {
  id: string;
  text: string;
}
export type SpeechState =
  | "ready"
  | "loading"
  | "playing"
  | "paused"
  | "stopped"
  | "done"
  | "error";
interface Prepared {
  result: ReturnType<typeof captureGeneration>;
  settings: string;
  text: string;
}

export class SpeechPlayer {
  state: SpeechState = "ready";
  answer?: Answer;
  index = 0;
  chunks: string[] = [];
  settings: VoiceSettings = { speed: 1, voice: "af_heart" };
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

  constructor(
    audio: Pick<LocalAudio, "warm" | "generate" | "play" | "close">,
    update: () => void,
    reportError: (message: string) => void
  ) {
    this.audio = audio;
    this.update = update;
    this.reportError = reportError;
  }

  get busy(): boolean {
    return ["loading", "playing", "paused"].includes(this.state);
  }

  /** Speculation is silent and bounded to one in-flight first chunk. */
  prepare(markdown?: string, complete = false): void {
    if (this.busy) {
      return;
    }
    if (!this.preparation) {
      this.preparation = new AbortController();
      // Foreground playback reports failures; background preparation never interrupts text.
      void ignoreRejection(
        this.audio.warm({ ...this.settings }, this.preparation.signal)
      );
    }
    if (markdown === undefined) {
      this.prepared = undefined;
      return;
    }
    const settings = { ...this.settings };
    const key = JSON.stringify([settings, this.includeAll]);
    if (!markdown || this.preparing || this.prepared?.settings === key) {
      return;
    }
    const chunks = speechChunks(markdown, this.includeAll);
    const [text] = chunks;
    if (!text || (!complete && chunks.length < 2)) {
      return;
    }
    const controller = this.preparation;
    this.preparing = true;
    this.prepared = {
      result: this.prepareFirst(text, settings, controller),
      settings: key,
      text,
    };
  }

  private async prepareFirst(
    text: string,
    settings: VoiceSettings,
    controller: AbortController
  ) {
    try {
      return await captureGeneration(
        this.audio.generate(text, settings, controller.signal)
      );
    } finally {
      if (this.preparation === controller) {
        this.preparing = false;
      }
    }
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
      this.state =
        this.playback && this.playbackStarted ? "playing" : "loading";
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
    const { prepared } = this;
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
    this.finished = this.run(controller, prepared);
  }

  private async waitForResume(signal: AbortSignal): Promise<void> {
    if (this.state === "paused") {
      const resumed: PromiseWithResolvers<void> = Promise.withResolvers();
      this.resumeWait = resumed.resolve;
      await resumed.promise;
    }
    signal.throwIfAborted();
  }

  private updatePlaybackState(state: "loading" | "playing"): void {
    // Commands can pause playback while an awaited operation is pending.
    if (this.state !== "paused") {
      this.state = state;
    }
    this.update();
  }

  private async resolveChunk(
    text: string,
    signal: AbortSignal,
    prepared?: Prepared
  ): Promise<{ key: string; path: string; settings: VoiceSettings }> {
    const ready = await prepared?.result;
    await this.waitForResume(signal);
    const settings = { ...this.settings };
    const key = JSON.stringify([settings, this.includeAll]);
    const matches = prepared?.text === text && prepared.settings === key;
    if (ready?.error && matches) {
      throw ready.error;
    }
    const filename =
      matches && ready?.path
        ? ready.path
        : await this.audio.generate(text, settings, signal);
    signal.throwIfAborted();
    await this.waitForResume(signal);
    if (key !== JSON.stringify([this.settings, this.includeAll])) {
      return this.resolveChunk(text, signal, prepared);
    }
    return { key, path: filename, settings };
  }

  private async playChunk(
    text: string,
    signal: AbortSignal,
    prepared?: Prepared
  ): Promise<Prepared | undefined> {
    await this.waitForResume(signal);
    const chunk = await this.resolveChunk(text, signal, prepared);
    const playback = this.audio.play(chunk.path, signal);
    this.playback = playback;
    this.playbackStarted = false;
    await playback.started;
    signal.throwIfAborted();
    this.playbackStarted = true;
    this.updatePlaybackState("playing");
    const next = this.chunks[this.index + 1];
    // Observe rejection immediately, even if stopped before the next sentence.
    const upcoming = next
      ? {
          result: captureGeneration(
            this.audio.generate(next, chunk.settings, signal)
          ),
          settings: chunk.key,
          text: next,
        }
      : undefined;
    await playback.done;
    signal.throwIfAborted();
    this.playback = undefined;
    this.updatePlaybackState("loading");
    return upcoming;
  }

  private async run(
    controller: AbortController,
    prepared?: Prepared
  ): Promise<void> {
    try {
      let upcoming = prepared;
      // Audio chunks must play sequentially, never through Promise.all().
      for await (const text of this.chunks.slice(this.index)) {
        controller.signal.throwIfAborted();
        upcoming = await this.playChunk(text, controller.signal, upcoming);
        this.index += 1;
      }
      this.state = "done";
      this.update();
    } catch (error) {
      if (this.signal !== controller || controller.signal.aborted) {
        return;
      }
      controller.abort();
      this.playback = undefined;
      this.state = "error";
      this.reportError(
        error instanceof Error ? error.message : "Speech failed."
      );
      this.update();
    }
  }

  async close(): Promise<void> {
    this.stop();
    await this.audio.close();
    await this.finished;
  }
}
