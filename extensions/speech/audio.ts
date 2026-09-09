import type { ChildProcess, ChildProcessByStdio } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { promisify } from "node:util";

import { ignoreRejection } from "./async.ts";
import { setupPath, workerCommand, workerEnvironment } from "./runtime.ts";

export interface SynthesisSettings {
  voice: string;
}
export interface VoiceSettings extends SynthesisSettings {
  speed: number;
}

export const validateSpeed = (speed: number): void => {
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
    throw new RangeError("Playback speed must be between 0.5 and 2.");
  }
};
type WorkerProcess = ChildProcessByStdio<Writable, Readable, null>;
interface StartupTimeout {
  handle?: ReturnType<typeof setTimeout>;
}
const cacheLimit = 32 * 1024 * 1024;

export class LocalAudio {
  private directory?: Promise<string>;
  private worker?: WorkerProcess;
  private player?: WorkerProcess;
  private playerReady?: Promise<WorkerProcess>;
  private activePlayback?: {
    finish: (error?: Error) => void;
    id: number;
    started: (outputDelayMs: number) => void;
  };
  private pending?: {
    id: number;
    reject: (error: Error) => void;
    resolve: () => void;
  };
  private children = new Map<ChildProcess, Promise<void>>();
  private serial: Promise<void> = Promise.resolve();
  private counter = 0;
  private cache = new Map<string, { bytes: number; path: string }>();
  private closed = false;

  async install(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.closed) {
      throw new Error("Speech is closed.");
    }
    const completion: PromiseWithResolvers<void> = Promise.withResolvers();
    let timedOut = false;
    let output = "";
    const child = spawn("sh", [setupPath], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stop = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The process group already exited.
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, 20 * 60_000);
    const collect = (chunk: string) => {
      output = (output + chunk).slice(-1500);
    };
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) {
      stop();
    }
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf-8");
      stream.on("data", collect);
    }
    child.once("error", completion.reject);
    // Clean up descendants if the shell exits early.
    child.once("exit", stop);
    child.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      if (signal.aborted) {
        completion.reject(signal.reason);
      } else if (code === 0) {
        completion.resolve();
      } else {
        completion.reject(
          new Error(
            timedOut
              ? "Setup timed out."
              : output.trim() || "The installer exited without completing."
          )
        );
      }
    });
    await completion.promise;
  }

  async checkReady(signal?: AbortSignal): Promise<boolean> {
    if (this.closed) {
      return false;
    }
    try {
      const command = workerCommand("--check");
      const { stdout } = await promisify(execFile)(
        command.executable,
        command.args,
        {
          env: workerEnvironment(),
          signal,
          timeout: 30_000,
        }
      );
      // A helper without pitch-preserving playback must be rebuilt before it is used.
      const status = JSON.parse(stdout);
      return (
        status.ready === true &&
        status.albert === "cpuAndGPU" &&
        status.playbackRate === 1
      );
    } catch {
      return false;
    }
  }

  private track(child: ChildProcess): void {
    const completion: PromiseWithResolvers<void> = Promise.withResolvers();
    child.once("close", () => {
      this.children.delete(child);
      completion.resolve();
    });
    this.children.set(child, completion.promise);
  }

  private startWorker(directory: string): WorkerProcess {
    const command = workerCommand(directory);
    const child = spawn(command.executable, command.args, {
      env: workerEnvironment(),
      stdio: ["pipe", "pipe", "ignore"],
    });
    this.track(child);
    this.worker = child;
    const lines = createInterface({ input: child.stdout });
    const fail = (error: Error) => {
      if (this.worker !== child) {
        return;
      }
      this.worker = undefined;
      const { pending } = this;
      this.pending = undefined;
      pending?.reject(error);
      child.kill("SIGKILL");
    };
    lines.on("line", (line) => {
      if (this.worker !== child) {
        return;
      }
      try {
        const response = JSON.parse(line);
        if (!this.pending || response.id !== this.pending.id) {
          throw new Error("Invalid speech worker response.");
        }
        const { pending } = this;
        this.pending = undefined;
        if (response.error) {
          pending.reject(
            new Error(`Speech synthesis failed (${response.error}).`)
          );
        } else if (Number.isFinite(response.seconds) && response.seconds > 0) {
          pending.resolve();
        } else {
          pending.reject(new Error("Speech worker returned empty audio."));
        }
      } catch {
        fail(new Error("Invalid speech worker response."));
      }
    });
    child.on("error", () =>
      fail(
        new Error(
          "Read-aloud could not start. Use /speech setup in Pi to install or repair it. Text responses still work."
        )
      )
    );
    child.stdin.on("error", () =>
      fail(new Error("Speech worker input closed."))
    );
    child.on("close", () => {
      lines.close();
      fail(
        new Error(
          "Read-aloud stopped unexpectedly. Use /speech setup in Pi to check or repair it. Text responses still work."
        )
      );
    });
    return child;
  }

  async warm(settings: SynthesisSettings, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    // Exercise pronunciation and inference, not just imports. Never play the sample.
    await Promise.all([
      this.generate("Ready to read.", settings, signal, true),
      this.preparePlayback(),
    ]);
  }

  generate(
    text: string,
    settings: SynthesisSettings,
    signal: AbortSignal,
    warmup = false
  ): Promise<string> {
    const task = this.generateAfter(
      this.serial,
      text,
      { voice: settings.voice },
      signal,
      warmup
    );
    this.serial = ignoreRejection(task);
    return task;
  }

  private async synthesize(
    child: WorkerProcess,
    id: number,
    text: string,
    settings: SynthesisSettings,
    signal: AbortSignal
  ): Promise<void> {
    const completion: PromiseWithResolvers<void> = Promise.withResolvers();
    const cancel = (error: Error) => {
      // Core ML prediction may not stop promptly. Kill only our synthesis
      // worker; keep playback alive and reload lazily.
      if (this.worker === child) {
        this.worker = undefined;
        this.pending = undefined;
      }
      child.kill("SIGKILL");
      completion.reject(error);
    };
    const abort = () => cancel(signal.reason ?? new Error("Speech cancelled."));
    const timer = setTimeout(
      () => cancel(new Error("Speech generation timed out.")),
      120_000
    );
    signal.addEventListener("abort", abort, { once: true });
    this.pending = {
      id,
      reject: completion.reject,
      resolve: () => completion.resolve(),
    };
    try {
      if (signal.aborted) {
        abort();
      } else {
        child.stdin.write(
          `${JSON.stringify({ id, text, voice: settings.voice })}\n`
        );
      }
      await completion.promise;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  }

  private async generateAfter(
    previous: Promise<void>,
    text: string,
    settings: SynthesisSettings,
    signal: AbortSignal,
    warmup: boolean
  ): Promise<string> {
    await previous;
    signal.throwIfAborted();
    if (this.closed) {
      throw new Error("Speech is closed.");
    }
    const key = JSON.stringify([text, settings.voice]);
    const cached = !warmup && this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.path;
    }
    const directory = await (this.directory ??= mkdtemp(
      path.join(tmpdir(), "pi-dyslexia-speech-")
    ));
    signal.throwIfAborted();
    if (this.closed) {
      throw new Error("Speech is closed.");
    }
    const child = this.worker ?? this.startWorker(directory);
    this.counter += 1;
    const id = this.counter;
    const filename = path.join(directory, `${id}.wav`);
    try {
      await this.synthesize(child, id, text, settings, signal);
      signal.throwIfAborted();
      if (warmup) {
        await rm(filename, { force: true });
        return filename;
      }
      const { size: bytes } = await stat(filename);
      if (bytes > cacheLimit) {
        throw new Error(
          "Generated speech chunk exceeds the 32 MiB audio limit."
        );
      }
      this.cache.set(key, { bytes, path: filename });
      await this.evict(key);
      return filename;
    } catch (error) {
      if (this.worker !== child) {
        await this.children.get(child);
      }
      await ignoreRejection(rm(filename, { force: true }));
      throw error;
    }
  }

  private async evict(currentKey: string): Promise<void> {
    let size = [...this.cache.values()].reduce(
      (total, entry) => total + entry.bytes,
      0
    );
    const removals: Promise<void>[] = [];
    for (const [key, entry] of this.cache) {
      if (size <= cacheLimit || key === currentKey) {
        break;
      }
      this.cache.delete(key);
      size -= entry.bytes;
      removals.push(rm(entry.path, { force: true }));
    }
    await Promise.all(removals);
  }

  private preparePlayback(): Promise<WorkerProcess> {
    if (this.closed) {
      return Promise.reject(new Error("Speech is closed."));
    }
    if (this.playerReady) {
      return this.playerReady;
    }
    const command = workerCommand("--player");
    const child = spawn(command.executable, command.args, {
      env: workerEnvironment(),
      stdio: ["pipe", "pipe", "ignore"],
    });
    this.track(child);
    this.player = child;
    const completion = Promise.withResolvers<WorkerProcess>();
    this.playerReady = completion.promise;
    const lines = createInterface({ input: child.stdout });
    const timeout: StartupTimeout = {};
    const fail = (error: Error) => {
      if (this.player !== child) {
        return;
      }
      clearTimeout(timeout.handle);
      this.player = undefined;
      this.playerReady = undefined;
      completion.reject(error);
      this.activePlayback?.finish(error);
      child.kill("SIGKILL");
    };
    timeout.handle = setTimeout(
      () => fail(new Error("Audio device startup timed out.")),
      10_000
    );
    lines.on("line", (line) => {
      if (this.player !== child) {
        return;
      }
      try {
        const message = JSON.parse(line);
        if (message.error) {
          fail(new Error(`macOS audio playback failed (${message.error}).`));
          return;
        }
        if (message.event === "ready") {
          clearTimeout(timeout.handle);
          completion.resolve(child);
          return;
        }
        if (
          !["started", "done"].includes(message.event) ||
          !Number.isInteger(message.id)
        ) {
          throw new Error("Invalid audio player event.");
        }
        // A stop can race with an acknowledgement already in the pipe.
        const active = this.activePlayback;
        if (!active || message.id !== active.id) {
          return;
        }
        if (message.event === "started") {
          if (!Number.isFinite(message.output_delay_ms)) {
            throw new TypeError("Invalid audio output delay.");
          }
          active.started(message.output_delay_ms);
        } else {
          active.finish();
        }
      } catch {
        fail(new Error("Invalid audio player response."));
      }
    });
    child.on("error", () =>
      fail(new Error("Could not start macOS audio playback."))
    );
    child.stdin.on("error", () =>
      fail(new Error("Audio player input closed."))
    );
    child.on("close", () => {
      lines.close();
      fail(new Error("Audio player stopped unexpectedly."));
    });
    return completion.promise;
  }

  play(filename: string, signal: AbortSignal, speed = 1) {
    signal.throwIfAborted();
    validateSpeed(speed);
    this.counter += 1;
    const id = this.counter;
    const started = Promise.withResolvers<number>();
    const done: PromiseWithResolvers<void> = Promise.withResolvers();
    // Both can reject before the caller reaches its await.
    void ignoreRejection(started.promise);
    void ignoreRejection(done.promise);
    let child: WorkerProcess | undefined;
    let paused = false;
    let playbackSpeed = speed;
    let began = false;
    let finished = false;
    const listeners = new AbortController();
    const send = (action: string, rate?: number) => {
      if (child && this.player === child && !child.stdin.destroyed) {
        child.stdin.write(`${JSON.stringify({ action, id, speed: rate })}\n`);
      }
    };
    const finish = (error?: Error) => {
      if (finished) {
        return;
      }
      finished = true;
      listeners.abort();
      if (this.activePlayback?.id === id) {
        this.activePlayback = undefined;
      }
      const failure =
        error ??
        (began
          ? undefined
          : new Error("Playback ended before its first buffer."));
      if (failure) {
        started.reject(failure);
        done.reject(failure);
      } else {
        done.resolve();
      }
    };
    const abort = () => {
      send("stop");
      finish(signal.reason ?? new Error("Speech cancelled."));
    };
    signal.addEventListener("abort", abort, {
      once: true,
      signal: listeners.signal,
    });
    const begin = async () => {
      try {
        const ready = await this.preparePlayback();
        if (finished) {
          return;
        }
        signal.throwIfAborted();
        if (this.closed) {
          throw new Error("Speech is closed.");
        }
        if (this.activePlayback) {
          throw new Error("Audio playback is already active.");
        }
        child = ready;
        this.activePlayback = {
          finish,
          id,
          started: (delay) => {
            began = true;
            started.resolve(delay);
          },
        };
        child.stdin.write(
          `${JSON.stringify({ action: "play", id, path: filename, paused, speed: playbackSpeed })}\n`
        );
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new Error("Audio playback failed.", { cause: error })
        );
      }
    };
    void begin();
    return {
      done: done.promise,
      pause: () => {
        paused = true;
        send("pause");
      },
      resume: () => {
        paused = false;
        send("resume");
      },
      setSpeed: (rate: number) => {
        validateSpeed(rate);
        if (finished) {
          return;
        }
        playbackSpeed = rate;
        send("rate", rate);
      },
      started: started.promise,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.activePlayback?.finish(new Error("Speech closed."));
    this.pending?.reject(new Error("Speech closed."));
    this.pending = undefined;
    this.worker = undefined;
    for (const child of this.children.keys()) {
      child.kill("SIGKILL");
    }
    await this.serial;
    await Promise.all(this.children.values());
    if (this.directory) {
      await rm(await this.directory, { force: true, recursive: true });
    }
    this.cache.clear();
  }
}
