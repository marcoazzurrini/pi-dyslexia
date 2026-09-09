import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { LocalAudio } from "../extensions/speech/audio.ts";
import { until } from "./helpers.ts";

interface WorkerRequest {
  id: number;
  action?: string;
  text?: string;
  voice?: string;
  speed?: number;
  path?: string;
  paused?: boolean;
}

test("audio protocol separates synthesis from live playback speed and keeps cached WAVs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pi-speech-protocol-"));
  const log = path.join(directory, "requests.jsonl");
  const fixture = fileURLToPath(
    new URL("fixtures/speech-worker.mjs", import.meta.url)
  );
  let audio: LocalAudio | undefined;
  try {
    await writeFile(log, "");
    await Promise.all(
      ["audio.ts", "async.ts"].map((name) =>
        copyFile(
          new URL(`../extensions/speech/${name}`, import.meta.url),
          path.join(directory, name)
        )
      )
    );
    // Replace only the copied runtime boundary; production remains network-sandboxed.
    await writeFile(
      path.join(directory, "runtime.ts"),
      `
      export const setupPath = "unused";
      export const workerCommand = (argument: string) => ({
        executable: ${JSON.stringify(process.execPath)},
        args: [${JSON.stringify(fixture)}, argument],
      });
      export const workerEnvironment = () => ({ ...process.env, SPEECH_TEST_LOG: ${JSON.stringify(log)} });
    `
    );
    const module: { LocalAudio: typeof LocalAudio } = await import(
      pathToFileURL(path.join(directory, "audio.ts")).href
    );
    audio = new module.LocalAudio();
    const controller = new AbortController();
    const settings = { speed: 1.5, voice: "af_heart" };
    const first = await audio.generate(
      "Keep the backup.",
      settings,
      controller.signal
    );
    settings.speed = 2;
    assert.equal(
      await audio.generate("Keep the backup.", settings, controller.signal),
      first
    );
    await audio.warm(settings, controller.signal);
    const requests = async (): Promise<WorkerRequest[]> => {
      const text = await readFile(log, "utf-8");
      return text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    };
    const waitFor = (action: string) =>
      until(
        async () => {
          const entries = await requests();
          return entries.find((entry) => entry.action === action);
        },
        100,
        10
      );
    const generated = await requests();
    assert.deepEqual(
      generated.map(({ id: _id, ...request }) => request),
      [
        { text: "Keep the backup.", voice: "af_heart" },
        { text: "Ready to read.", voice: "af_heart" },
      ]
    );
    const playback = audio.play(first, controller.signal, 1.25);
    // These commands precede begin's readiness await and must reach the eventual play request.
    playback.pause();
    playback.setSpeed(1.5);
    const play = await waitFor("play");
    assert.equal(play?.speed, 1.5);
    assert.equal(play?.paused, true);
    playback.setSpeed(2);
    playback.resume();
    await waitFor("resume");
    const rate = await waitFor("rate");
    assert.equal(rate?.speed, 2);
    for (const speed of [0.49, 2.01, Number.NaN, Infinity]) {
      assert.throws(() => playback.setSpeed(speed), /Playback speed/u);
      assert.throws(
        () => audio?.play(first, controller.signal, speed),
        /Playback speed/u
      );
    }
    const started = assert.rejects(playback.started);
    const done = assert.rejects(playback.done);
    controller.abort();
    await Promise.all([started, done]);
    await waitFor("stop");
    const before = await requests();
    playback.setSpeed(1);
    const after = await requests();
    assert.deepEqual(
      after,
      before,
      "finished handles cannot change a later playback"
    );
  } finally {
    await audio?.close();
    await rm(directory, { force: true, recursive: true });
  }
});
