"""Small local comparison; writes only fixed public test passages, never session text.

Run with ~/.cache/pi-dyslexia/venv/bin/python docs/research/benchmark-speech.py ENGINE.
Kokoro must be set up first. Pocket TTS is an optional benchmark dependency.
VoxCPM2 requires the pinned snapshot below to have been downloaded explicitly.
No audio is played. Results and samples go under ~/.cache/pi-dyslexia/benchmarks/ENGINE.
"""

import argparse
import contextlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import resource
import subprocess
import sys
import time

PASSAGES = [
    "Warning: do not delete the backup. The server returned ECONNREFUSED on port 8080.",
    "Response time fell by 12.5 percent in a small test. This may not generalize to production.",
    "Before running npm test, open package.json. Retry only if the request is idempotent.",
]
VOX_MODEL = "mlx-community/VoxCPM2-8bit"
VOX_REVISION = "d52725898a0675703f7f9ddc5a4d1a3cdbb99032"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("engine", choices=["kokoro", "pocket", "voxcpm", "macos"])
    parser.add_argument("--trials", type=int, default=3)
    args = parser.parse_args()
    output = Path.home() / ".cache/pi-dyslexia/benchmarks" / args.engine
    output.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    started = time.perf_counter()
    import numpy as np
    import soundfile as sf
    model = voice = None
    if args.engine == "kokoro":
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "extensions/speech"))
        import worker
        with contextlib.redirect_stdout(sys.stderr):
            model, path = worker.load()
        revision = worker.REVISION
    elif args.engine == "pocket":
        from pocket_tts import TTSModel
        with contextlib.redirect_stdout(sys.stderr):
            model = TTSModel.load_model()
            voice = model.get_state_for_audio_prompt("alba")
        revision = "pocket-tts 3.1.0 packaged English config; cached Hub revisions recorded separately"
    elif args.engine == "voxcpm":
        from huggingface_hub import snapshot_download
        from mlx_audio.tts.utils import load_model
        path = snapshot_download(VOX_MODEL, revision=VOX_REVISION, local_files_only=True)
        with contextlib.redirect_stdout(sys.stderr):
            model = load_model(path, model_type="voxcpm2")
        revision = VOX_REVISION
    else:
        revision = platform.mac_ver()[0]
    load_seconds = time.perf_counter() - started
    versions = {}
    for name in ["mlx-audio", "mlx", "misaki", "spacy", "numpy", "torch", "pocket-tts", "huggingface-hub"]:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            pass
    metadata = {"engine": args.engine, "revision": revision, "platform": platform.platform(),
                "versions": versions, "load_seconds": load_seconds, "passages": PASSAGES,
                "voice": {"kokoro": "af_heart", "pocket": "alba", "voxcpm": "default, 10 steps", "macos": "Samantha, 175 wpm baseline"}[args.engine],
                "note": "First chunk ready is not acoustic onset. No human accuracy or comfort scores collected. Seeds are not fixed. RSS covers this process only; macOS speech-service memory is excluded."}
    (output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    rates = [1.0, 1.25, 1.5] if args.engine in ["kokoro", "macos"] else [1.0]
    with (output / "results.jsonl").open("w") as results:
        for rate in rates:
            for trial in range(args.trials):
                for number, text in enumerate(PASSAGES):
                    filename = output / f"rate-{rate}-trial-{trial}-passage-{number}.wav"
                    before = time.perf_counter()
                    first = None
                    with contextlib.redirect_stdout(sys.stderr):
                        if args.engine == "kokoro":
                            duration = worker.generate(model, path, text, "af_heart", rate, filename)
                        elif args.engine == "macos":
                            subprocess.run(["/usr/bin/say", "-v", "Samantha", "-r", str(round(175 * rate)),
                                            "-o", str(filename), "--data-format=LEI16@24000", text], check=True, timeout=60)
                            duration = sf.info(filename).duration
                        else:
                            blocks = []
                            if args.engine == "pocket":
                                iterator = model.generate_audio_stream(voice, text)
                            else:
                                iterator = model.generate(text=text, inference_timesteps=10, max_tokens=400)
                            for chunk in iterator:
                                block = np.asarray(chunk.detach().cpu() if args.engine == "pocket" else chunk.audio).reshape(-1)
                                if first is None:
                                    first = time.perf_counter() - before
                                blocks.append(block)
                            sample_rate = model.sample_rate
                            pcm = np.concatenate(blocks)
                            sf.write(filename, pcm, sample_rate)
                            duration = len(pcm) / sample_rate
                    elapsed = time.perf_counter() - before
                    row = {"rate": rate, "trial": trial, "passage": number, "generation_seconds": elapsed,
                           "first_chunk_seconds": first if first is not None else elapsed,
                           "audio_seconds": duration, "realtime_multiple": duration / elapsed,
                           "peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                           "file": filename.name}
                    if args.engine in ["kokoro", "voxcpm"]:
                        import mlx.core as mx
                        row["peak_metal_bytes"] = mx.get_peak_memory()
                    if rate == 1.0 and trial == 0 and number == 0:
                        row["cold_first_chunk_seconds"] = load_seconds + row["first_chunk_seconds"]
                    results.write(json.dumps(row) + "\n")
                    results.flush()
                    print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
