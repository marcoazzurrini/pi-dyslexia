import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { LocalAudio } from "../speech/audio.ts";

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
    await audio.generate("The worker can restart.", settings, controller.signal);
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
    const playback = audio.play(silentPath, controller.signal);
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
    controller.abort();
    await stopped;
  } finally {
    await audio.close();
    await rm(temp, { recursive: true, force: true });
  }
  await assert.rejects(access(directory), { code: "ENOENT" });
});
