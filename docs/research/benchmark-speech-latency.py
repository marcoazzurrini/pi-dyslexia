"""Measure the shipped worker offline, without playing speech or reading session text.

Run with ~/.cache/pi-dyslexia/venv/bin/python docs/research/benchmark-speech-latency.py.
Add --playback to measure the real player with synthetic silence (no microphone).
JSON goes to stdout; temporary WAVs and child processes are cleaned up.
These are process/callback timings, NOT measured acoustic onset.
"""

import argparse
from array import array
from datetime import datetime, timezone
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import selectors
import statistics
import subprocess
import sys
import tempfile
import time
import wave

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "extensions/speech/worker.py"
PASSAGES = [
    "Warning: do not delete the backup.",
    "Response time fell by 12.5 percent in a small test. This may not generalize to production.",
    "Before deploying the updated service, check the configuration and the backup, verify that the database migration preserves existing records, review the error handling for failed requests, confirm that the health checks pass under normal load, keep the previous release available for rollback, and ask another developer to review the changes because a successful local test does not establish that the service will behave correctly in production when the network is slow or dependencies fail.",
]

# Instrument the real worker in a fresh process. Bypass its redirected stderr only
# for numeric timing records; never print synthesis text or dependency warnings.
PROBE = r'''
import sys, time
started = time.perf_counter()
sys.path.insert(0, sys.argv.pop(1))
import worker, json
original_load, original_generate = worker.load, worker.generate

def load(*args, **kwargs):
    before = time.perf_counter()
    result = original_load(*args, **kwargs)
    print(json.dumps({"load_ms": (time.perf_counter()-before)*1000,
                      "child_to_loaded_ms": (time.perf_counter()-started)*1000}), file=sys.__stderr__, flush=True)
    return result

def generate(*args, **kwargs):
    before = time.perf_counter()
    result = original_generate(*args, **kwargs)
    print(json.dumps({"inference_and_wav_ms": (time.perf_counter()-before)*1000}), file=sys.__stderr__, flush=True)
    return result

worker.load, worker.generate = load, generate
worker.main()
'''

def response(child):
    with selectors.DefaultSelector() as poll:
        poll.register(child.stdout, selectors.EVENT_READ)
        if not poll.select(120):
            raise TimeoutError("Speech worker did not respond within 120 seconds.")
    line = child.stdout.readline()
    if not line:
        raise RuntimeError("Speech worker exited without a response.")
    result = json.loads(line)
    if "error" in result:
        raise RuntimeError(result["error"])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trials", type=int, default=3)
    parser.add_argument("--speed", type=float, default=1.5)
    parser.add_argument("--playback", action="store_true")
    args = parser.parse_args()
    if args.trials < 1 or not 0.5 <= args.speed <= 2:
        parser.error("Use positive trials and speed 0.5–2.")
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
    rows, playback = [], []
    with tempfile.TemporaryDirectory(prefix="pi-dyslexia-latency-") as temporary:
        directory = Path(temporary)
        for trial in range(args.trials):
            with tempfile.TemporaryFile(mode="w+") as trace:
                started = time.perf_counter()
                child = subprocess.Popen([sys.executable, "-u", "-c", PROBE, str(WORKER.parent), temporary],
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=trace, bufsize=0)
                try:
                    for number, text in enumerate([PASSAGES[0], *PASSAGES]):
                        before = started if number == 0 else time.perf_counter()
                        child.stdin.write((json.dumps({"id": number, "text": text, "voice": "af_heart", "speed": args.speed}) + "\n").encode())
                        child.stdin.flush()
                        result = response(child)
                        elapsed = (time.perf_counter() - before) * 1000
                        assert result["id"] == number and result["seconds"] > 0
                        with wave.open(str(directory / f"{number}.wav"), "rb") as wav:
                            pcm = array("h", wav.readframes(wav.getnframes()))
                        if sys.byteorder != "little":
                            pcm.byteswap()
                        onset = next((i for i, sample in enumerate(pcm) if abs(sample) >= 328), None)
                        assert onset is not None
                        rows.append({"trial": trial, "kind": "cold" if number == 0 else "warm",
                                     "characters": len(text), "request_to_wav_ms": elapsed,
                                     "leading_below_minus40db_ms": onset / 24,
                                     "audio_seconds": result["seconds"]})
                    child.stdin.close()
                    child.wait(timeout=10)
                    assert child.returncode == 0
                finally:
                    if child.poll() is None:
                        child.kill()
                    child.wait()
                    child.stdout.close()
                    if not child.stdin.closed:
                        child.stdin.close()
                trace.seek(0)
                timings = [json.loads(line) for line in trace if line.startswith("{")]
                assert len(timings) == 5
                rows[-4].update(timings[0])
                for row, timing in zip(rows[-4:], timings[1:]):
                    row.update(timing)
        if args.playback:
            silence = directory / "silence.wav"
            with wave.open(str(silence), "wb") as wav:
                wav.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
                wav.writeframes(bytes(24000))  # 0.5 seconds, int16 mono.
            for trial in range(args.trials):
                before = time.perf_counter()
                child = subprocess.Popen([sys.executable, "-u", str(WORKER), "--player"],
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
                try:
                    assert response(child)["event"] == "ready"
                    row = {"trial": trial, "process_to_ready_ms": (time.perf_counter()-before)*1000, "chunks": []}
                    for number in range(3):
                        requested = time.perf_counter()
                        child.stdin.write((json.dumps({"id": number, "action": "play", "path": str(silence)}) + "\n").encode())
                        first = response(child)
                        assert first["event"] == "started" and first["id"] == number
                        row["chunks"].append({"request_to_started_ack_ms": (time.perf_counter()-requested)*1000,
                                              "output_delay_ms": first["output_delay_ms"]})
                        assert response(child) == {"id": number, "event": "done"}
                    child.stdin.close()
                    child.wait(timeout=10)
                    assert child.returncode == 0
                    playback.append(row)
                finally:
                    if child.poll() is None:
                        child.kill()
                    child.wait()
                    for stream in (child.stdin, child.stdout, child.stderr):
                        stream.close()
    print(json.dumps({"captured_at": datetime.now(timezone.utc).isoformat(),
                      "platform": platform.platform(), "python": platform.python_version(),
                      "versions": {name: importlib.metadata.version(name) for name in
                                   ("mlx-audio", "mlx", "misaki", "spacy", "sounddevice")},
                      "speed": args.speed, "voice": "af_heart", "passages": PASSAGES,
                      "note": "Fresh processes with cached assets; no Pi lifecycle or acoustic measurement. Playback uses only silence.",
                      "generation": rows, "playback": playback,
                      "cold_median_ms": statistics.median(r["request_to_wav_ms"] for r in rows if r["kind"] == "cold")}, indent=2))


if __name__ == "__main__":
    main()
