// Run: node scripts/benchmarks/speech-first-listen.mjs
// Node 24; installed native runtime required. No downloads or audible speech.
// Uses production orchestration, not an experimental backend or executable override.
// Opens the current output device with synthetic silence. No microphone or settings changes.
// PI_FIRST_LISTEN_ROUNDS accepts 1–20 (default 4). Results go to a private temporary directory.
// Copy useful results before temporary cleanup; summarize findings in docs/research/speech.md.
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { LocalAudio } from "../../extensions/speech/audio.ts";
import { SpeechPlayer } from "../../extensions/speech/player.ts";

process.umask(0o077);
const output = await mkdtemp(path.join(tmpdir(), "pi-speech-first-listen-"));
const answer = {
  id: "public-benchmark",
  text: "Warning: do not delete the backup. The server returned ECONNREFUSED on port 8080.",
};
const settings = { voice: "af_heart", speed: 1.5 };
const scenarios = ["manual", "automatic-no-lead", "automatic-prepared"];
const rounds = Number(process.env.PI_FIRST_LISTEN_ROUNDS ?? 4);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) {
  throw new Error("Expected 1–20 benchmark rounds.");
}

// Our worker produces a fixed 44-byte PCM16 WAV header. Measure the original
// signal, then replace every sample with silence before calling the real player.
function mute(filename) {
  const begin = performance.now();
  const wav = readFileSync(filename);
  if (
    wav.length < 44 ||
    wav.toString("ascii", 0, 4) !== "RIFF" ||
    wav.toString("ascii", 8, 16) !== "WAVEfmt " ||
    wav.readUInt32LE(4) !== wav.length - 8 ||
    wav.readUInt32LE(16) !== 16 ||
    wav.readUInt16LE(20) !== 1 ||
    wav.readUInt16LE(22) !== 1 ||
    wav.readUInt32LE(24) !== 24_000 ||
    wav.readUInt16LE(34) !== 16 ||
    wav.toString("ascii", 36, 40) !== "data" ||
    wav.readUInt32LE(40) !== wav.length - 44 ||
    (wav.length - 44) % 2 !== 0
  ) {
    throw new Error("Unexpected benchmark WAV.");
  }
  const pcm = wav.subarray(44);
  const window = 240; // 10 ms at 24 kHz
  const threshold = 32767 * 10 ** (-50 / 20);
  let onset;
  for (let index = 0; index < pcm.length / 2; index += window) {
    const count = Math.min(window, pcm.length / 2 - index);
    let energy = 0;
    for (let sample = 0; sample < count; sample += 1) {
      energy += pcm.readInt16LE((index + sample) * 2) ** 2;
    }
    if (Math.sqrt(energy / count) >= threshold) {
      onset = index / 24;
      break;
    }
  }
  if (onset === undefined) {
    throw new Error("Speech contains no measurable signal.");
  }
  pcm.fill(0);
  writeFileSync(filename, wav);
  return { mutingMs: performance.now() - begin, signalOnsetMs: onset };
}

async function observe(scenario, round) {
  const audio = new LocalAudio();
  const first = Promise.withResolvers();
  // Observe early failures even during the untimed preparation scenario.
  void first.promise.catch(() => {});
  const player = new SpeechPlayer(
    audio,
    () => {},
    (message) => first.reject(new Error(message))
  );
  player.settings = { ...settings };
  const play = audio.play.bind(audio);
  let start;
  audio.play = (filename, signal, speed = 1) => {
    const signalInfo = mute(filename);
    // The WAV is synthesized at 1x; estimate its onset on the playback timeline.
    signalInfo.signalOnsetMs /= speed;
    const playback = play(filename, signal, speed);
    playback.started.then((outputDelayMs) => {
      first.resolve({
        ackMs: performance.now() - start,
        outputDelayMs,
        ...signalInfo,
      });
    }, first.reject);
    return playback;
  };
  const watchdog = setTimeout(
    () => first.reject(new Error("Benchmark timed out.")),
    60_000
  );
  try {
    if (!(await audio.checkReady()))
      throw new Error("Run npm run setup:speech first.");
    const preparing = performance.now();
    if (scenario === "automatic-prepared") {
      player.prepare(answer.text, true);
      // Wait for the actual warm-up, first chunk, and open audio device. This is
      // deliberately untimed lead time, not a claim about typical LLM duration.
      await audio["serial"];
      await audio["playerReady"];
    }
    const preparationLeadMs =
      scenario === "automatic-prepared" ? performance.now() - preparing : 0;
    start = performance.now();
    if (scenario === "automatic-no-lead") player.prepare();
    player.start(answer);
    const result = await first.promise;
    const correctedFirstBufferMs = result.ackMs - result.mutingMs;
    return {
      scenario,
      round,
      preparationLeadMs,
      ...result,
      correctedFirstBufferMs,
      estimatedFirstSignalMs:
        correctedFirstBufferMs +
        Math.max(0, result.outputDelayMs) +
        result.signalOnsetMs,
      firstChunkText: player.chunks[0],
    };
  } finally {
    clearTimeout(watchdog);
    await player.close();
  }
}

const records = [];
console.log("Results directory:", output);
for (let round = 0; round < rounds; round += 1) {
  for (const scenario of round % 2 ? [...scenarios].reverse() : scenarios) {
    const record = await observe(scenario, round);
    records.push(record);
    await writeFile(
      path.join(output, "records.json"),
      `${JSON.stringify(records, null, 2)}\n`
    );
    console.log(
      scenario,
      round,
      `${Math.round(record.estimatedFirstSignalMs)} ms`
    );
  }
}
const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return (
    (sorted[Math.floor((sorted.length - 1) / 2)] +
      sorted[Math.floor(sorted.length / 2)]) /
    2
  );
};
const summaries = scenarios.map((scenario) => {
  const values = records
    .filter((row) => row.scenario === scenario)
    .map((row) => row.estimatedFirstSignalMs);
  return {
    scenario,
    n: values.length,
    medianEstimatedFirstSignalMs: median(values),
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
  };
});
await writeFile(
  path.join(output, "results.json"),
  `${JSON.stringify(
    {
      date: new Date().toISOString(),
      answer,
      settings,
      method:
        "Production FluidAudio with ALBERT CPU/GPU routing. Fresh workers per observation; installed models and OS caches retained. Manual and automatic-no-lead time Play with no advance preparation. Automatic-prepared excludes measured preparationLeadMs, after the real warm-up and first-chunk preparation finish. Readiness checks are outside all timers. Only equal-length silence reaches the real output device; muting overhead is subtracted. Estimated first signal adds reported output latency and the original first 10 ms RMS window above -50 dBFS. Not a microphone measurement. No concurrent-manual-start experiment or backend override.",
      records,
      summaries,
    },
    null,
    2
  )}\n`
);
console.log(JSON.stringify(summaries, null, 2));
