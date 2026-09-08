"""Offline Kokoro synthesis and owned playback workers. JSON lines; no transcript logs."""

import contextlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import wave

MODEL = "mlx-community/Kokoro-82M-bf16"
REVISION = "a71e4d38b236d968966a2002c4c895dbd12b1c3c"
PATTERNS = ["*.json", "*.safetensors", "voices/*.safetensors"]


def model_path(download=False):
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_OFFLINE"] = "0" if download else "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "0" if download else "1"
    from huggingface_hub import snapshot_download
    return Path(snapshot_download(MODEL, revision=REVISION,
                                  allow_patterns=PATTERNS, local_files_only=not download))


def check():
    # ponytail: startup checks installed files, not inference; playback still reports damaged or incompatible runtimes.
    for module in ("mlx", "mlx_audio", "misaki", "spacy", "numpy", "huggingface_hub", "sounddevice", "en_core_web_sm"):
        if importlib.util.find_spec(module) is None:
            raise RuntimeError(f"Missing {module}. Use /speech setup in Pi.")
    path = model_path()
    files = [path / "config.json", *(path / "voices" / f"{voice}.safetensors"
             for voice in ("af_heart", "af_bella", "am_michael", "bf_emma", "bm_george"))]
    weights = list(path.glob("*.safetensors"))
    if not weights or any(not file.is_file() or file.stat().st_size == 0 for file in [*files, *weights]):
        raise RuntimeError("The voice model is incomplete. Use /speech setup in Pi.")


def load(download=False):
    path = model_path(download)
    import spacy.util
    if not spacy.util.is_package("en_core_web_sm"):
        raise RuntimeError("The English dictionary is missing. Use /speech setup in Pi.")
    from mlx_audio.tts.utils import load_model
    return load_model(str(path), model_type="kokoro"), path


def generate(model, model_path, text, voice, speed, output):
    import numpy as np
    if not isinstance(text, str) or not text.strip() or len(text) > 2000:
        raise ValueError("Expected 1–2000 characters.")
    if not isinstance(voice, str) or not re.fullmatch(r"[ab][fm]_[a-z]+", voice):
        raise ValueError("Expected an English voice preset.")
    if not isinstance(speed, (int, float)) or isinstance(speed, bool) or not 0.5 <= speed <= 2:
        raise ValueError("Expected speed between 0.5 and 2.")
    voice_path = model_path / "voices" / f"{voice}.safetensors"
    if not voice_path.is_file():
        raise ValueError("Voice is not downloaded.")
    pipeline = model._get_pipeline(voice[0])
    if pipeline.g2p.fallback is None:
        raise RuntimeError("The pronunciation fallback is missing; refusing to skip unknown words.")
    samples = 0
    with wave.open(str(output), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(24000)
        for result in model.generate(text=text, voice=str(voice_path), speed=speed, lang_code=voice[0]):
            pcm = np.asarray(result.audio).reshape(-1)
            if result.sample_rate != 24000 or not np.isfinite(pcm).all():
                raise ValueError("Invalid model audio.")
            pcm = (np.clip(pcm, -1, 1) * 32767).astype("<i2")
            if not samples:
                pcm = trim_initial_silence(pcm)
            audio.writeframes(pcm.tobytes())
            samples += pcm.size
    if not samples:
        raise ValueError("Model produced no audio.")
    return samples / 24000


def trim_initial_silence(pcm):
    """Remove only exact leading zeros, retaining 20 ms before the first sample."""
    import numpy as np
    nonzero = np.flatnonzero(pcm)
    return pcm[max(0, int(nonzero[0]) - 480):] if nonzero.size else pcm


class PlaybackBuffer:
    """Advance only when audio is consumed, never while paused."""

    def __init__(self, pcm):
        self.pcm = pcm
        self.position = 0
        self.paused = False

    def read(self, frames):
        size = frames * 2  # mono int16
        if self.paused:
            return bytes(size), False
        block = self.pcm[self.position:self.position + size]
        self.position += len(block)
        return block.ljust(size, b"\0"), self.position >= len(self.pcm)


def play():
    """One output stream per owned player; JSON commands never run in the callback."""
    import sounddevice as sd
    import threading
    from queue import SimpleQueue
    events = SimpleQueue()
    lock = threading.Lock()
    current = None
    ready = False

    def report():
        while True:
            event = events.get()
            if event is None:
                return
            print(json.dumps(event), flush=True)

    def callback(output, frames, clock, _status):
        nonlocal current, ready
        output[:] = bytes(frames * 2)
        if not ready:
            ready = True
            events.put({"event": "ready"})
        with lock:
            if current is None:
                return
            identity, buffer = current
            if buffer.paused:
                return
            if buffer.position == 0:
                events.put({"id": identity, "event": "started",
                            "output_delay_ms": (clock.outputBufferDacTime - clock.currentTime) * 1000})
            block, done = buffer.read(frames)
            output[:] = block
            if done:
                current = None
                events.put({"id": identity, "event": "done"})

    reporter = threading.Thread(target=report, daemon=True)
    reporter.start()
    try:
        with sd.RawOutputStream(samplerate=24000, channels=1, dtype="int16", blocksize=512,
                                latency="low", callback=callback,
                                finished_callback=lambda: events.put({"error": "Audio stream stopped."})):
            for line in sys.stdin:
                request = {}
                try:
                    request = json.loads(line)
                    identity = request["id"]
                    if type(identity) is not int or identity < 0:
                        raise ValueError("Invalid playback ID.")
                    action = request["action"]
                    if action == "play":
                        with wave.open(request["path"], "rb") as audio:
                            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 24000):
                                raise ValueError("Expected 24 kHz mono int16 WAV.")
                            if not 0 < audio.getnframes() * 2 <= 32 * 1024 * 1024:
                                raise ValueError("Invalid playback size.")
                            pcm = audio.readframes(audio.getnframes())
                            if len(pcm) != audio.getnframes() * 2:
                                raise ValueError("Incomplete WAV.")
                        buffer = PlaybackBuffer(pcm)
                        buffer.paused = request.get("paused", False) is True
                        with lock:
                            if current is not None:
                                raise ValueError("Playback is already active.")
                            current = (identity, buffer)
                    elif action in ("stop", "pause", "resume"):
                        with lock:
                            if current is not None and current[0] == identity:
                                if action == "stop":
                                    current = None
                                else:
                                    current[1].paused = action == "pause"
                    else:
                        raise ValueError("Invalid playback command.")
                except Exception as error:
                    events.put({"id": request.get("id") if isinstance(request, dict) else None,
                                "error": type(error).__name__})
    finally:
        events.put(None)
        reporter.join(timeout=1)


def main():
    os.umask(0o077)
    if sys.argv[1:] == ["--player"]:
        play()
        return
    if sys.argv[1:] == ["--check"]:
        check()
        return
    if sys.argv[1:] == ["--download"]:
        _, path = load(download=True)
        print(f"Kokoro ready: {path}")
        return
    directory = Path(sys.argv[1]).resolve(strict=True)
    # Keep third-party progress/warnings out of the protocol and do not log text.
    with open(os.devnull, "w") as quiet:
        with contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
            model, path = load()
        for line in sys.stdin:
            request = {}
            try:
                request = json.loads(line)
                identity = request["id"]
                if type(identity) is not int or identity < 0:
                    raise ValueError("Invalid request ID.")
                with contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
                    seconds = generate(model, path, request["text"], request["voice"],
                                       request["speed"], directory / f"{identity}.wav")
                response = {"id": identity, "seconds": seconds}
            except Exception as error:
                response = {"id": request.get("id"), "error": type(error).__name__}
            print(json.dumps(response), flush=True)


if __name__ == "__main__":
    main()
