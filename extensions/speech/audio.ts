import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export type VoiceSettings = { voice: string; speed: number };
export const python = join(homedir(), ".cache/pi-dyslexia/venv/bin/python");
const workerPath = fileURLToPath(new URL("worker.py", import.meta.url));
const cacheLimit = 32 * 1024 * 1024;

export class LocalAudio {
  private directory?: Promise<string>;
  private worker?: ChildProcess;
  private player?: ChildProcess;
  private playerReady?: Promise<ChildProcess>;
  private activePlayback?: { id: number; started: (outputDelayMs: number) => void; finish: (error?: Error) => void };
  private pending?: { id: number; resolve: () => void; reject: (error: Error) => void };
  private children = new Map<ChildProcess, Promise<void>>();
  private serial = Promise.resolve();
  private counter = 0;
  private cache = new Map<string, { path: string; bytes: number }>();
  private closed = false;

  async install(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      let timedOut = false;
      let output = "";
      const child = spawn("sh", [fileURLToPath(new URL("setup.sh", import.meta.url))], {
        detached: true, stdio: ["ignore", "pipe", "pipe"],
      });
      const stop = () => {
        if (child.pid) {
          try { process.kill(-child.pid, "SIGKILL"); } catch { /* The process group already exited. */ }
        }
      };
      const timer = setTimeout(() => { timedOut = true; stop(); }, 20 * 60_000);
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
      for (const stream of [child.stdout!, child.stderr!]) {
        stream.setEncoding("utf8");
        stream.on("data", (chunk: string) => { output = (output + chunk).slice(-1500); });
      }
      child.once("error", reject);
      child.once("exit", stop); // Clean up descendants if the shell exits early.
      child.once("close", (code) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
        if (signal.aborted) reject(signal.reason);
        else if (code !== 0) reject(new Error(timedOut ? "Setup timed out." : output.trim() || "The installer exited without completing."));
        else resolve();
      });
    });
  }

  async checkReady(signal?: AbortSignal): Promise<boolean> {
    try {
      await promisify(execFile)(python, [workerPath, "--check"], {
        signal, timeout: 30_000,
        env: { ...process.env, HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", TRANSFORMERS_OFFLINE: "1" },
      });
      return true;
    } catch {
      return false;
    }
  }

  private track(child: ChildProcess): void {
    const done = new Promise<void>((resolve) => child.once("close", () => {
      this.children.delete(child);
      resolve();
    }));
    this.children.set(child, done);
  }

  private startWorker(directory: string): ChildProcess {
    const child = spawn(python, ["-u", workerPath, directory], {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", TRANSFORMERS_OFFLINE: "1" },
    });
    this.track(child);
    this.worker = child;
    const lines = createInterface({ input: child.stdout! });
    const fail = (error: Error) => {
      if (this.worker !== child) return;
      this.worker = undefined;
      const pending = this.pending;
      this.pending = undefined;
      pending?.reject(error);
      child.kill("SIGKILL");
    };
    lines.on("line", (line) => {
      if (this.worker !== child) return;
      try {
        const response = JSON.parse(line);
        if (!this.pending || response.id !== this.pending.id) throw new Error("Invalid speech worker response.");
        const pending = this.pending;
        this.pending = undefined;
        if (response.error) pending.reject(new Error(`Speech synthesis failed (${response.error}).`));
        else if (!(response.seconds > 0)) pending.reject(new Error("Speech worker returned empty audio."));
        else pending.resolve();
      } catch {
        fail(new Error("Invalid speech worker response."));
      }
    });
    child.on("error", () => fail(new Error("Read-aloud could not start. Use /speech setup in Pi to install or repair it. Text responses still work.")));
    child.stdin!.on("error", () => fail(new Error("Speech worker input closed.")));
    child.on("close", () => {
      lines.close();
      fail(new Error("Read-aloud stopped unexpectedly. Use /speech setup in Pi to check or repair it. Text responses still work."));
    });
    return child;
  }

  async warm(settings: VoiceSettings, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    // Exercise pronunciation and inference, not just imports. Never play the sample.
    await Promise.all([this.generate("Ready to read.", settings, signal, true), this.preparePlayback()]);
  }

  generate(text: string, settings: VoiceSettings, signal: AbortSignal, warmup = false): Promise<string> {
    const task = this.serial.then(async () => {
      signal.throwIfAborted();
      if (this.closed) throw new Error("Speech is closed.");
      const key = JSON.stringify([text, settings.voice, settings.speed]);
      const cached = !warmup && this.cache.get(key);
      if (cached) {
        this.cache.delete(key);
        this.cache.set(key, cached);
        return cached.path;
      }
      const directory = await (this.directory ??= mkdtemp(join(tmpdir(), "pi-dyslexia-speech-")));
      signal.throwIfAborted();
      if (this.closed) throw new Error("Speech is closed.");
      const child = this.worker ?? this.startWorker(directory);
      const id = ++this.counter;
      const path = join(directory, `${id}.wav`);
      try {
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            error ? reject(error) : resolve();
          };
          const cancel = (error: Error) => {
            // MLX has no per-request interrupt. Kill only our worker, then reload lazily.
            if (this.worker === child) {
              this.worker = undefined;
              this.pending = undefined;
            }
            child.kill("SIGKILL");
            finish(error);
          };
          const abort = () => cancel(signal.reason ?? new Error("Speech cancelled."));
          const timer = setTimeout(() => cancel(new Error("Speech generation timed out.")), 120_000);
          signal.addEventListener("abort", abort, { once: true });
          this.pending = { id, resolve: () => finish(), reject: finish };
          child.stdin!.write(JSON.stringify({ id, text, ...settings }) + "\n");
        });
        signal.throwIfAborted();
        if (warmup) {
          await rm(path, { force: true });
          return path;
        }
        const bytes = (await stat(path)).size;
        if (bytes > cacheLimit) throw new Error("Generated speech chunk exceeds the 32 MiB audio limit.");
        this.cache.set(key, { path, bytes });
        let size = [...this.cache.values()].reduce((total, entry) => total + entry.bytes, 0);
        for (const [oldKey, entry] of this.cache) {
          if (size <= cacheLimit || oldKey === key) break;
          this.cache.delete(oldKey);
          size -= entry.bytes;
          await rm(entry.path, { force: true });
        }
        return path;
      } catch (error) {
        if (this.worker !== child) await this.children.get(child);
        await rm(path, { force: true }).catch(() => {});
        throw error;
      }
    });
    this.serial = task.then(() => {}, () => {});
    return task;
  }

  private preparePlayback(): Promise<ChildProcess> {
    if (this.closed) return Promise.reject(new Error("Speech is closed."));
    if (this.playerReady) return this.playerReady;
    const child = spawn(python, ["-u", workerPath, "--player"], { stdio: ["pipe", "pipe", "ignore"] });
    this.track(child);
    this.player = child;
    this.playerReady = new Promise<ChildProcess>((resolve, reject) => {
      const lines = createInterface({ input: child.stdout! });
      const fail = (error: Error) => {
        if (this.player !== child) return;
        clearTimeout(timer);
        this.player = undefined;
        this.playerReady = undefined;
        reject(error);
        this.activePlayback?.finish(error);
        child.kill("SIGKILL");
      };
      const timer = setTimeout(() => fail(new Error("Audio device startup timed out.")), 10_000);
      lines.on("line", (line) => {
        if (this.player !== child) return;
        try {
          const message = JSON.parse(line);
          if (message.error) { fail(new Error(`macOS audio playback failed (${message.error}).`)); return; }
          if (message.event === "ready") { clearTimeout(timer); resolve(child); return; }
          if (!["started", "done"].includes(message.event) || !Number.isInteger(message.id)) throw new Error();
          // A stop can race with an acknowledgement already in the pipe.
          const active = this.activePlayback;
          if (!active || message.id !== active.id) return;
          if (message.event === "started") {
            if (!Number.isFinite(message.output_delay_ms)) throw new Error();
            active.started(message.output_delay_ms);
          } else active.finish();
        } catch { fail(new Error("Invalid audio player response.")); }
      });
      child.on("error", () => fail(new Error("Could not start macOS audio playback.")));
      child.stdin!.on("error", () => fail(new Error("Audio player input closed.")));
      child.on("close", () => { lines.close(); fail(new Error("Audio player stopped unexpectedly.")); });
    });
    return this.playerReady;
  }

  play(path: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const id = ++this.counter;
    const started = Promise.withResolvers<number>();
    const done = Promise.withResolvers<void>();
    // Both can reject before the caller reaches its await.
    void started.promise.catch(() => {});
    void done.promise.catch(() => {});
    let child: ChildProcess | undefined;
    let paused = false;
    let began = false;
    let finished = false;
    const send = (action: string) => {
      if (child && this.player === child && !child.stdin!.destroyed) {
        child.stdin!.write(JSON.stringify({ id, action }) + "\n");
      }
    };
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", abort);
      if (this.activePlayback?.id === id) this.activePlayback = undefined;
      if (!error && !began) error = new Error("Playback ended before its first buffer.");
      if (error) { started.reject(error); done.reject(error); }
      else done.resolve();
    };
    const abort = () => { send("stop"); finish(signal.reason ?? new Error("Speech cancelled.")); };
    signal.addEventListener("abort", abort, { once: true });
    void this.preparePlayback().then((ready) => {
      if (finished) return;
      signal.throwIfAborted();
      if (this.closed) throw new Error("Speech is closed.");
      if (this.activePlayback) throw new Error("Audio playback is already active.");
      child = ready;
      this.activePlayback = { id, started: (delay) => { began = true; started.resolve(delay); }, finish };
      child.stdin!.write(JSON.stringify({ id, action: "play", path, paused }) + "\n");
    }).catch(finish);
    return {
      started: started.promise,
      done: done.promise,
      pause: () => { paused = true; send("pause"); },
      resume: () => { paused = false; send("resume"); },
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.activePlayback?.finish(new Error("Speech closed."));
    this.pending?.reject(new Error("Speech closed."));
    this.pending = undefined;
    this.worker = undefined;
    for (const child of this.children.keys()) child.kill("SIGKILL");
    await this.serial;
    await Promise.all(this.children.values());
    if (this.directory) await rm(await this.directory, { recursive: true, force: true });
    this.cache.clear();
  }
}
