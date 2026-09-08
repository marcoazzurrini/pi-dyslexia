// Run: node --experimental-strip-types docs/research/benchmark-speech-onset.mjs
// Uses real synthesis and playback controls, but substitutes synthetic silence.
// Measures start() to first-buffer acknowledgement, NOT acoustic onset or Pi finalization.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir, platform, arch } from "node:os";
import { join } from "node:path";
import { LocalAudio, python } from "../../speech/audio.ts";
import { SpeechPlayer } from "../../speech/player.ts";

const directory = await mkdtemp(join(tmpdir(), "pi-speech-onset-"));
const silencePath = join(directory, "silence.wav");
const silence = Buffer.alloc(44 + 7200); // 150 ms, mono int16, 24 kHz.
silence.write("RIFF"); silence.writeUInt32LE(silence.length - 8, 4);
silence.write("WAVEfmt ", 8); silence.writeUInt32LE(16, 16);
silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
silence.writeUInt32LE(24000, 24); silence.writeUInt32LE(48000, 28);
silence.writeUInt16LE(2, 32); silence.writeUInt16LE(16, 34);
silence.write("data", 36); silence.writeUInt32LE(7200, 40);
await writeFile(silencePath, silence);
const rows = [];
const device = () => JSON.parse(execFileSync(python, ["-c", "import json,sounddevice as sd; print(json.dumps(sd.query_devices(kind='output')))"]));
try {
  const outputDeviceBefore = device();
  for (let trial = 0; trial < 3; trial++) {
    const audio = new LocalAudio();
    const errors = [];
    const player = new SpeechPlayer(audio, () => {}, (error) => errors.push(error));
    player.settings = { voice: "af_heart", speed: 1.5 };
    const originalPlay = audio.play.bind(audio);
    let row;
    audio.play = (path, signal) => {
      const wav = readFileSync(path);
      assert.equal(wav.toString("ascii", 36, 40), "data");
      const pcm = wav.subarray(44);
      row.leading_below_minus40db_ms = null;
      for (let i = 0; i < pcm.length; i += 2) {
        if (Math.abs(pcm.readInt16LE(i)) >= 328) { row.leading_below_minus40db_ms = i / 48; break; }
      }
      assert.notEqual(row.leading_below_minus40db_ms, null);
      const playback = originalPlay(silencePath, signal);
      void playback.started.then((delay) => {
        row.start_to_first_buffer_ack_ms = performance.now() - row.started;
        row.reported_output_delay_ms = delay;
        row.estimated_threshold_onset_ms = row.start_to_first_buffer_ack_ms + delay + row.leading_below_minus40db_ms;
      }, () => {});
      return playback;
    };
    async function run(kind, text, prepared = false) {
      row = { trial, kind };
      if (prepared) {
        const before = performance.now();
        player.prepare();
        player.prepare(text, true);
        // Intentionally inspect the task in this benchmark; never guess readiness with sleep().
        const ready = await player.prepared.result;
        assert.ok(ready.path);
        row.preparation_ms = performance.now() - before;
      }
      row.started = performance.now();
      player.start({ id: `${trial}-${rows.length}`, text });
      await player.finished;
      assert.deepEqual(errors, []);
      assert.ok(Number.isFinite(row.start_to_first_buffer_ack_ms));
      assert.ok(Number.isFinite(row.reported_output_delay_ms));
      delete row.started;
      rows.push(row);
    }
    try {
      await run("cold", "Warning: do not delete the backup.");
      await run("warm", "Keep the backup available until the migration succeeds.");
      if (trial === 0) for (let i = 1; i <= 20; i++) {
        await run("prepared", `Warning number ${i}: do not delete the backup.`, true);
      }
    } finally { await player.close(); }
  }
  const summary = {};
  for (const kind of ["cold", "warm", "prepared"]) {
    const values = rows.filter((row) => row.kind === kind).map((row) => row.start_to_first_buffer_ack_ms).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const estimates = rows.filter((row) => row.kind === kind).map((row) => row.estimated_threshold_onset_ms).sort((a, b) => a - b);
    summary[kind] = { count: values.length, median_ms: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
      p95_ms: values[Math.ceil(values.length * 0.95) - 1], max_ms: values.at(-1),
      estimated_onset_median_ms: estimates.length % 2 ? estimates[middle] : (estimates[middle - 1] + estimates[middle]) / 2,
      estimated_onset_p95_ms: estimates[Math.ceil(estimates.length * 0.95) - 1], estimated_onset_max_ms: estimates.at(-1) };
  }
  console.log(JSON.stringify({ captured_at: new Date().toISOString(), platform: `${platform()} ${arch()}`,
    output_device_before: outputDeviceBefore, output_device_after: device(),
    voice: "af_heart", speed: 1.5,
    note: "Only synthetic silence played. Preparation finishes before simulated settlement; cold/burst responses cannot assume that head start. Add device delay and generated lead-in to estimate audibility; no acoustic or live Pi measurement.",
    summary, rows }, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
