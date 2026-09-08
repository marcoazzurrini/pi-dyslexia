import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { LocalAudio, python } from "../extensions/speech/audio.ts";

// Opt-in integration check: uses downloaded Kokoro, but plays only synthetic silence.
test("local worker, cache, cancellation, silent player pause/resume and cleanup", {
  skip: process.env.PI_DYSLEXIA_AUDIO_TEST !== "1" || process.platform !== "darwin",
}, async () => {
  const audio = new LocalAudio();
  const temp = await mkdtemp(join(tmpdir(), "pi-speech-silence-"));
  let directory;
  try {
    const controller = new AbortController();
    const settings = { voice: "af_heart", speed: 1 };
    await promisify(execFile)(python, ["-c", `
import numpy as np
from worker import trim_initial_silence
pcm = np.array([0] * 1000 + [1, 0, -1, 32767], dtype='<i2')
trimmed = trim_initial_silence(pcm)
assert np.array_equal(trimmed, pcm[520:]), 'retain 20 ms before even the quietest sample'
assert np.array_equal(trim_initial_silence(pcm[900:]), pcm[900:]), 'never cut nonzero speech'
assert np.array_equal(trim_initial_silence(np.zeros(1000, dtype='<i2')), np.zeros(1000, dtype='<i2'))
`], { cwd: fileURLToPath(new URL("../extensions/speech", import.meta.url)), timeout: 10_000 });
    const path = await audio.generate("Ready to read. Do not delete the backup.", settings, controller.signal);
    directory = dirname(path);
    assert.equal((await readFile(path)).toString("ascii", 0, 4), "RIFF");
    assert.equal((await stat(path)).mode & 0o077, 0);
    assert.equal(await audio.generate("Ready to read. Do not delete the backup.", settings, controller.signal), path);
    const cancelled = new AbortController();
    const pending = audio.generate("A different sentence to test cancellation while the model is running.", settings, cancelled.signal);
    const rejected = assert.rejects(pending);
    await delay(30);
    cancelled.abort();
    await rejected;
    await audio.warm(settings, controller.signal);
    const warmedWorker = audio.worker;
    await audio.generate("The worker can restart.", settings, controller.signal);
    assert.equal(audio.worker, warmedWorker, "warm-up after cancellation initializes the replacement worker");
    const evicted = join(directory, "eviction-check.wav");
    await writeFile(evicted, "old cached audio");
    audio.cache.set("eviction-check", { path: evicted, bytes: 33 * 1024 * 1024 });
    await audio.generate("Keep the cache bounded.", settings, controller.signal);
    await assert.rejects(access(evicted), { code: "ENOENT" });

    const silence = Buffer.alloc(44 + 24000 * 2);
    silence.write("RIFF", 0); silence.writeUInt32LE(silence.length - 8, 4);
    silence.write("WAVEfmt ", 8); silence.writeUInt32LE(16, 16);
    silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
    silence.writeUInt32LE(24000, 24); silence.writeUInt32LE(48000, 28);
    silence.writeUInt16LE(2, 32); silence.writeUInt16LE(16, 34);
    silence.write("data", 36); silence.writeUInt32LE(silence.length - 44, 40);
    const silentPath = join(temp, "silence.wav");
    await writeFile(silentPath, silence);
    const playerProcess = audio.player;
    const playback = audio.play(silentPath, controller.signal);
    await playback.started;
    assert.equal(audio.player, playerProcess, "play uses the pre-opened output stream");
    let ended = false;
    const observed = playback.done.then(() => { ended = true; });
    await delay(100);
    playback.pause();
    await delay(1200);
    assert.equal(ended, false, "paused process retains the playback position rather than finishing");
    playback.resume();
    await observed;
    const next = audio.play(silentPath, controller.signal);
    const stopped = assert.rejects(next.done);
    await next.started;
    controller.abort();
    await stopped;
    const resumed = audio.play(silentPath, new AbortController().signal);
    await resumed.started;
    assert.equal(audio.player, playerProcess, "stop and subsequent chunks keep the same player and stream");
    await resumed.done;
    const invalid = audio.play(join(temp, "missing.wav"), new AbortController().signal);
    await assert.rejects(invalid.started, /playback failed/);
    await assert.rejects(invalid.done, /playback failed/);
    const recovered = audio.play(silentPath, new AbortController().signal);
    await recovered.started;
    assert.notEqual(audio.player, playerProcess, "a failed output process is replaced on explicit retry");
    await recovered.done;
    const earlyAudio = new LocalAudio();
    try {
      const early = new AbortController();
      const loading = earlyAudio.play(silentPath, early.signal);
      const rejectedStart = assert.rejects(loading.started);
      const rejectedDone = assert.rejects(loading.done);
      early.abort();
      await Promise.all([rejectedStart, rejectedDone]);
    } finally { await earlyAudio.close(); }
  } finally {
    await audio.close();
    await rm(temp, { recursive: true, force: true });
  }
  await assert.rejects(access(directory), { code: "ENOENT" });
});
