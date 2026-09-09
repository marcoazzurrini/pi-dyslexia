import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

interface Asset {
  remote: string;
  path: string;
  downloadSize: number;
  sourceSHA256: string;
  size: number;
  sha256: string;
  convertVoice?: boolean;
}
interface AssetLock {
  repository: string;
  revision: string;
  files: Asset[];
}

export const sha256 = (data: Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

/** JSON row 1 corresponds to binary row 0; verified against upstream af_heart.bin. */
export const convertVoice = (data: Uint8Array): Buffer => {
  const rows = JSON.parse(Buffer.from(data).toString("utf-8"));
  const binary = Buffer.alloc(510 * 256 * 4);
  for (let row = 0; row < 510; row += 1) {
    const values = rows[String(row + 1)];
    if (!Array.isArray(values) || values.length !== 256) {
      throw new Error("Invalid voice shape.");
    }
    for (let column = 0; column < 256; column += 1) {
      const value = values[column];
      if (!Number.isFinite(value) || Math.abs(value) > 3.402823466e38) {
        throw new Error("Invalid voice value.");
      }
      binary.writeFloatLE(value, (row * 256 + column) * 4);
    }
  }
  return binary;
};

const download = async (url: string, size: number): Promise<Buffer> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) {
    throw new Error(`Asset download failed (${response.status}).`);
  }
  const parts: Uint8Array[] = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received > size) {
      throw new Error("Asset exceeds its pinned size.");
    }
    parts.push(chunk);
  }
  if (received !== size) {
    throw new Error("Incomplete asset download.");
  }
  return Buffer.concat(parts);
};

export const installAssets = async (
  home: string,
  lock: AssetLock,
  fetchAsset = download
): Promise<void> => {
  if (!/^[a-f0-9]{40}$/u.test(lock.revision)) {
    throw new Error("Expected a pinned model revision.");
  }
  const root = path.join(home, ".cache/fluidaudio/Models");
  // Sequential transfers bound memory and keep setup cancellation predictable.
  for await (const asset of lock.files) {
    if (
      [asset.path, asset.remote].some((name) =>
        name.split("/").some((part) => part === ".." || part === "." || !part)
      )
    ) {
      throw new Error("Invalid asset path.");
    }
    const destination = path.join(root, asset.path);
    const existing = await readFile(destination).catch(() => null);
    if (existing?.length === asset.size && sha256(existing) === asset.sha256) {
      continue;
    }
    const url = `https://huggingface.co/${lock.repository}/resolve/${lock.revision}/${asset.remote}`;
    const bytes = await fetchAsset(url, asset.downloadSize);
    if (
      bytes.length !== asset.downloadSize ||
      sha256(bytes) !== asset.sourceSHA256
    ) {
      throw new Error(`Asset checksum mismatch: ${asset.remote}`);
    }
    const output = asset.convertVoice ? convertVoice(bytes) : bytes;
    if (output.length !== asset.size || sha256(output) !== asset.sha256) {
      throw new Error(`Prepared asset checksum mismatch: ${asset.path}`);
    }
    await mkdir(path.dirname(destination), { mode: 0o700, recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, output, { flag: "wx", mode: 0o600 });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }
};

const [, script, home] = process.argv;
if (script === import.meta.filename) {
  process.umask(0o077);
  if (!home || !path.isAbsolute(home)) {
    throw new Error("Expected an absolute, private runtime home.");
  }
  const lock: AssetLock = JSON.parse(
    await readFile(
      new URL("Sources/PiSpeech/Resources/assets.json", import.meta.url),
      "utf-8"
    )
  );
  await installAssets(home, lock);
  console.log(`Verified ${lock.files.length} pinned Kokoro assets.`);
}
