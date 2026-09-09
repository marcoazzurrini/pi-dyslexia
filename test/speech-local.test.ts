import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { LocalAudio } from "../extensions/speech/audio.ts";

const skipNative =
  process.env.PI_DYSLEXIA_AUDIO_TEST !== "1" ||
  process.platform !== "darwin" ||
  process.arch !== "arm64";

// Opt-in integration check: uses downloaded Kokoro, but plays only synthetic silence.
test(
  "local worker, cache, cancellation, silent player pause/resume and cleanup",
  {
    skip: skipNative,
    timeout: 120_000,
  },
  async () => {
    const audio = new LocalAudio();
    const temp = await mkdtemp(nodePath.join(tmpdir(), "pi-speech-silence-"));
    let directory: string | undefined;
    try {
      const controller = new AbortController();
      const settings = { speed: 1, voice: "af_heart" };
      assert.equal(
        await audio.checkReady(),
        true,
        "install the current native runtime first"
      );
      const path = await audio.generate(
        "Ready to read. Do not delete the backup.",
        settings,
        controller.signal
      );
      directory = nodePath.dirname(path);
      const wav = await readFile(path);
      const metadata = await stat(path);
      assert.equal(wav.toString("ascii", 0, 4), "RIFF");
      assert.equal(
        metadata.mode % 0o100,
        0,
        "group and other permission bits remain unset"
      );
      assert.equal(
        await audio.generate(
          "Ready to read. Do not delete the backup.",
          settings,
          controller.signal
        ),
        path
      );
      const healthyWorker = audio["worker"];
      await assert.rejects(
        audio.generate(
          "Reject invalid settings.",
          { voice: "missing_voice" },
          controller.signal
        ),
        /Speech synthesis failed/u
      );
      for (const speed of [0, 0.49, 2.01, Number.NaN, Infinity]) {
        assert.throws(
          () => audio.play(path, controller.signal, speed),
          /Playback speed/u
        );
      }
      assert.equal(
        audio["worker"],
        healthyWorker,
        "request errors do not discard the warm model"
      );
      const cancelled = new AbortController();
      const pending = audio.generate(
        "A different sentence to test cancellation while the model is running.",
        settings,
        cancelled.signal
      );
      const rejected = assert.rejects(pending);
      await delay(30);
      cancelled.abort();
      await rejected;
      await audio.warm(settings, controller.signal);
      // Bracket access keeps these white-box checks typed without exposing internals publicly.
      const warmedWorker = audio["worker"];
      await audio.generate(
        "The worker can restart.",
        settings,
        controller.signal
      );
      assert.equal(
        audio["worker"],
        warmedWorker,
        "warm-up after cancellation initializes the replacement worker"
      );
      const evicted = nodePath.join(directory, "eviction-check.wav");
      await writeFile(evicted, "old cached audio");
      audio["cache"].set("eviction-check", {
        bytes: 33 * 1024 * 1024,
        path: evicted,
      });
      await audio.generate(
        "Keep the cache bounded.",
        settings,
        controller.signal
      );
      await assert.rejects(access(evicted), { code: "ENOENT" });

      const silence = Buffer.alloc(44 + 24_000 * 2);
      silence.write("RIFF", 0);
      silence.writeUInt32LE(silence.length - 8, 4);
      silence.write("WAVEfmt ", 8);
      silence.writeUInt32LE(16, 16);
      silence.writeUInt16LE(1, 20);
      silence.writeUInt16LE(1, 22);
      silence.writeUInt32LE(24_000, 24);
      silence.writeUInt32LE(48_000, 28);
      silence.writeUInt16LE(2, 32);
      silence.writeUInt16LE(16, 34);
      silence.write("data", 36);
      silence.writeUInt32LE(silence.length - 44, 40);
      const silentPath = nodePath.join(temp, "silence.wav");
      await writeFile(silentPath, silence);
      const playerProcess = audio["player"];
      const playback = audio.play(silentPath, controller.signal, 1.25);
      await playback.started;
      assert.equal(
        audio["player"],
        playerProcess,
        "play uses the pre-opened output stream"
      );
      let ended = false;
      const observeCompletion = async () => {
        await playback.done;
        ended = true;
      };
      const observed = observeCompletion();
      await delay(100);
      playback.pause();
      playback.setSpeed(1.5);
      await delay(1200);
      assert.equal(
        ended,
        false,
        "paused process retains the playback position rather than finishing"
      );
      playback.resume();
      await observed;
      for await (const speed of [0.5, 1, 1.25, 1.5, 2]) {
        const begin = performance.now();
        const timed = audio.play(silentPath, controller.signal, speed);
        await timed.started;
        await timed.done;
        const seconds = (performance.now() - begin) / 1000;
        assert.ok(
          seconds >= 1 / speed - 0.12,
          `no early completion at ${speed}x: ${seconds}s`
        );
        assert.ok(
          seconds < 1 / speed + 0.8,
          `bounded processing/device latency at ${speed}x: ${seconds}s`
        );
      }
      const liveBegin = performance.now();
      const live = audio.play(silentPath, controller.signal, 0.5);
      await live.started;
      await delay(100);
      live.setSpeed(2);
      await live.done;
      assert.ok(
        performance.now() - liveBegin < 1800,
        "a live speed change affects the current buffer, not only the next chunk"
      );
      // Freeze playback before the first render, change speed, then resume without losing its start.
      const initiallyPaused = audio.play(silentPath, controller.signal, 1.25);
      initiallyPaused.pause();
      initiallyPaused.setSpeed(2);
      let startedWhilePaused = false;
      void initiallyPaused.started.then(() => {
        startedWhilePaused = true;
      });
      await delay(300);
      assert.equal(startedWhilePaused, false);
      initiallyPaused.resume();
      await initiallyPaused.done;
      const next = audio.play(silentPath, controller.signal);
      const stopped = assert.rejects(next.done);
      await next.started;
      next.pause();
      controller.abort();
      await stopped;
      const resumed = audio.play(silentPath, new AbortController().signal);
      await resumed.started;
      assert.equal(
        audio["player"],
        playerProcess,
        "stop and subsequent chunks keep the same player and stream"
      );
      await resumed.done;
      const invalid = audio.play(
        nodePath.join(temp, "missing.wav"),
        new AbortController().signal
      );
      await assert.rejects(invalid.started, /playback failed/u);
      await assert.rejects(invalid.done, /playback failed/u);
      const recovered = audio.play(silentPath, new AbortController().signal);
      await recovered.started;
      assert.notEqual(
        audio["player"],
        playerProcess,
        "a failed output process is replaced on explicit retry"
      );
      await recovered.done;
      const earlyAudio = new LocalAudio();
      try {
        const early = new AbortController();
        const loading = earlyAudio.play(silentPath, early.signal);
        const rejectedStart = assert.rejects(loading.started);
        const rejectedDone = assert.rejects(loading.done);
        early.abort();
        await Promise.all([rejectedStart, rejectedDone]);
      } finally {
        await earlyAudio.close();
      }
    } finally {
      await audio.close();
      await rm(temp, { force: true, recursive: true });
    }
    assert.ok(directory);
    await assert.rejects(access(directory), { code: "ENOENT" });
  }
);

test(
  "native synthesis supports every preset, reuses audio across playback speeds, and handles long input",
  {
    skip: skipNative,
    timeout: 120_000,
  },
  async () => {
    const audio = new LocalAudio();
    const { signal } = new AbortController();
    try {
      assert.equal(await audio.checkReady(), true);
      for await (const voice of [
        "af_heart",
        "af_bella",
        "am_michael",
        "bf_emma",
        "bm_george",
      ]) {
        let cached: string | undefined;
        for await (const speed of [0.5, 1, 1.25, 1.5, 2]) {
          const settings = { speed, voice };
          const filename = await audio.generate(
            "Warning: do not delete the backup. Port 8080 returned ECONNREFUSED.",
            settings,
            signal
          );
          if (cached) {
            assert.equal(
              filename,
              cached,
              "playback speed never changes synthesized audio"
            );
          }
          cached = filename;
          const wav = await readFile(filename);
          assert.equal(wav.toString("ascii", 0, 4), "RIFF");
          assert.equal(wav.readUInt32LE(24), 24_000);
          assert.equal(wav.readUInt32LE(40), wav.length - 44);
          assert.ok(wav.length > 44);
        }
      }
      const warmWorker = audio["worker"];
      const text =
        "Before retrying the request, verify that the backup is complete and keep the original file. ".repeat(
          10
        );
      const filename = await audio.generate(
        text,
        { voice: "af_heart" },
        signal
      );
      const metadata = await stat(filename);
      assert.ok(metadata.size > 44);
      assert.equal(
        audio["worker"],
        warmWorker,
        "voice changes and long-input retries retain the model"
      );
      assert.equal(audio["worker"], warmWorker);
      assert.equal(
        audio["player"],
        undefined,
        "synthesis checks never open an output device"
      );
    } finally {
      await audio.close();
    }
  }
);
