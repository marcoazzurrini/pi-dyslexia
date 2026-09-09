import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalAudio } from "../extensions/speech/audio.ts";
import {
  convertVoice,
  installAssets,
  sha256,
} from "../extensions/speech/native/assets.ts";
import {
  setupPath,
  workerCommand,
  workerEnvironment,
} from "../extensions/speech/runtime.ts";

test("the sole speech runtime is isolated and always network-sandboxed", (t) => {
  const original = process.env;
  process.env = { ...original };
  t.after(() => {
    process.env = original;
  });
  // A leftover experiment setting cannot re-enable Python or bypass the sandbox.
  process.env.PI_DYSLEXIA_SPEECH_BACKEND = "mlx";
  process.env.CI = "1";
  for (const argument of ["--check", "--player", "/tmp/speech-output"]) {
    const native = workerCommand(argument);
    assert.equal(native.executable, "/usr/bin/sandbox-exec");
    assert.ok(
      native.args.includes("(version 1)(allow default)(deny network*)")
    );
    assert.equal(native.args.at(-1), argument);
    assert.match(native.args.at(-2) ?? "", /native\/bin\/pi-speech$/u);
  }
  const environment = workerEnvironment();
  assert.equal(
    environment.CFFIXED_USER_HOME,
    environment.PI_DYSLEXIA_NATIVE_HOME
  );
  assert.match(
    environment.CFFIXED_USER_HOME ?? "",
    /pi-dyslexia\/native\/home$/u
  );
  assert.equal(environment.OS_ACTIVITY_MODE, "disable");
  assert.equal(environment.CI, undefined);
  assert.match(setupPath, /native\/setup\.sh$/u);
  assert.equal(
    process.env.CI,
    "1",
    "worker isolation does not mutate Pi's environment"
  );
});

test("a closed audio adapter cannot install or report readiness", async () => {
  const audio = new LocalAudio();
  await audio.close();
  assert.equal(await audio.checkReady(), false);
  await assert.rejects(
    audio.install(new AbortController().signal),
    /Speech is closed/u
  );
});

test("voice conversion preserves all 510 float32 rows and rejects invalid data", () => {
  const rows = Object.fromEntries(
    Array.from({ length: 510 }, (_, row) => [
      String(row + 1),
      Array.from({ length: 256 }, () => (row + 1) / 1000),
    ])
  );
  const converted = convertVoice(Buffer.from(JSON.stringify(rows)));
  assert.equal(converted.length, 510 * 256 * 4);
  assert.equal(converted.readFloatLE(0), Math.fround(0.001));
  assert.equal(converted.readFloatLE(509 * 256 * 4), Math.fround(0.51));
  assert.throws(() => convertVoice(Buffer.from("{}")), /Invalid voice shape/u);
  const secondRow = rows["2"];
  assert.ok(secondRow);
  secondRow[0] = Number.NaN;
  assert.throws(
    () => convertVoice(Buffer.from(JSON.stringify(rows))),
    /Invalid voice value/u
  );
});

test("asset installation is pinned, verified, resumable, and repairs corruption", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "pi-native-assets-"));
  const bytes = Buffer.from("test model");
  const hash = sha256(bytes);
  const lock = {
    files: [
      {
        downloadSize: bytes.length,
        path: "kokoro/model.bin",
        remote: "ANE/model.bin",
        sha256: hash,
        size: bytes.length,
        sourceSHA256: hash,
      },
    ],
    repository: "FluidInference/kokoro-82m-coreml",
    revision: "a".repeat(40),
  };
  let calls = 0;
  const download = (url: string, size: number) => {
    calls += 1;
    assert.ok(url.includes(`/resolve/${lock.revision}/`));
    assert.equal(size, bytes.length);
    return Promise.resolve(bytes);
  };
  const destination = path.join(
    home,
    ".cache/fluidaudio/Models/kokoro/model.bin"
  );
  try {
    await installAssets(home, lock, download);
    assert.deepEqual(await readFile(destination), bytes);
    const metadata = await stat(destination);
    assert.equal(metadata.mode % 0o1000, 0o600);
    await installAssets(home, lock, download);
    assert.equal(calls, 1, "valid assets do not download again");
    await writeFile(destination, "corrupted!");
    await assert.rejects(
      installAssets(home, lock, () =>
        Promise.resolve(Buffer.alloc(bytes.length))
      ),
      /checksum mismatch/u
    );
    await installAssets(home, lock, download);
    assert.equal(calls, 2);
    await assert.rejects(
      installAssets(home, { ...lock, revision: "main" }, download),
      /pinned/u
    );
    const [firstAsset] = lock.files;
    assert.ok(firstAsset);
    await assert.rejects(
      installAssets(
        home,
        { ...lock, files: [{ ...firstAsset, path: "../escape" }] },
        download
      ),
      /Invalid asset path/u
    );
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("native model lock includes all voices, G2P, lexicon, and seven model stages", async () => {
  const lock = JSON.parse(
    await readFile(
      new URL(
        "../extensions/speech/native/Sources/PiSpeech/Resources/assets.json",
        import.meta.url
      ),
      "utf-8"
    )
  );
  const paths = lock.files.map((file: { path: string }) => file.path);
  for (const voice of [
    "af_heart",
    "af_bella",
    "am_michael",
    "bf_emma",
    "bm_george",
  ]) {
    assert.ok(paths.includes(`kokoro-82m-coreml/ANE/${voice}.bin`));
  }
  for (const file of [
    "kokoro/us_lexicon_cache.json",
    "kokoro/g2p_vocab.json",
    "kokoro/G2PEncoder.mlmodelc/model.mil",
    "kokoro/G2PDecoder.mlmodelc/model.mil",
  ]) {
    assert.ok(paths.includes(file));
  }
  assert.equal(
    paths.filter(
      (name: string) =>
        name.startsWith("kokoro-82m-coreml/ANE/") && name.endsWith("/model.mil")
    ).length,
    7
  );
  assert.equal(lock.files.length, 53);
});
