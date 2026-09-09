// Maintenance only: regenerate the reviewed asset lock when updating FluidAudio.
import { mkdir, writeFile } from "node:fs/promises";

import {
  convertVoice,
  sha256 as hash,
} from "../extensions/speech/native/assets.ts";

const repository = "FluidInference/kokoro-82m-coreml";
const revision = "acac8811a9acefe8bf7a5e3fcba99bd8fc50dcd6";
const stages = [
  "KokoroAlbert",
  "KokoroPostAlbert",
  "KokoroAlignment",
  "KokoroProsody",
  "KokoroNoise_v2",
  "KokoroVocoder",
  "KokoroTail_v2",
];
const response = await fetch(
  `https://huggingface.co/api/models/${repository}/tree/${revision}?recursive=true&limit=1000`
);
if (!response.ok || response.headers.has("link")) {
  throw new Error("Incomplete asset tree.");
}
const tree = await response.json();
const selected = tree.filter(
  (entry) =>
    entry.type === "file" &&
    (stages.some((stage) => entry.path.startsWith(`ANE/${stage}.mlmodelc/`)) ||
      /^ANE\/(?:vocab\.json|af_heart\.bin)$/u.test(entry.path) ||
      /^(?:G2PEncoder\.mlmodelc\/|G2PDecoder\.mlmodelc\/|g2p_vocab\.json$|us_lexicon_cache\.json$)/u.test(
        entry.path
      ) ||
      /^voices\/(?:af_bella|am_michael|bf_emma|bm_george)\.json$/u.test(
        entry.path
      ))
);
const files = [];
for await (const entry of selected) {
  const voice = entry.path.startsWith("voices/");
  let bytes;
  if (!entry.lfs || voice) {
    const fetched = await fetch(
      `https://huggingface.co/${repository}/resolve/${revision}/${entry.path}`
    );
    if (!fetched.ok) {
      throw new Error(`Asset unavailable: ${entry.path}`);
    }
    bytes = Buffer.from(await fetched.arrayBuffer());
    if (bytes.length !== entry.size) {
      throw new Error(`Asset size mismatch: ${entry.path}`);
    }
  }
  const sourceSHA256 = entry.lfs?.oid ?? hash(bytes);
  let local = entry.path.startsWith("ANE/")
    ? `kokoro-82m-coreml/${entry.path}`
    : `kokoro/${entry.path}`;
  let { size } = entry;
  let sha256 = sourceSHA256;
  if (voice) {
    const binary = convertVoice(bytes);
    local = `kokoro-82m-coreml/ANE/${entry.path.slice(7, -5)}.bin`;
    size = binary.length;
    sha256 = hash(binary);
  }
  files.push({
    convertVoice: voice,
    downloadSize: entry.size,
    path: local,
    remote: entry.path,
    sha256,
    size,
    sourceSHA256,
  });
}
if (files.length !== 53) {
  throw new Error(`Review changed asset set: ${files.length} files.`);
}
const directory = new URL(
  "../extensions/speech/native/Sources/PiSpeech/Resources/",
  import.meta.url
);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL("assets.json", directory),
  `${JSON.stringify({ files, repository, revision }, null, 2)}\n`
);
console.log(
  `Locked ${files.length} files; ${Math.round(files.reduce((sum, file) => sum + file.downloadSize, 0) / 1_048_576)} MiB download.`
);
