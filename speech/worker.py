"""Offline Kokoro synthesis worker. JSON lines in/out; no playback or transcript logs."""

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
            audio.writeframes((np.clip(pcm, -1, 1) * 32767).astype("<i2").tobytes())
            samples += pcm.size
    if not samples:
        raise ValueError("Model produced no audio.")
    return samples / 24000


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


def play(path):
    import sounddevice as sd
    import threading
    with wave.open(str(path), "rb") as audio:
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise ValueError("Expected mono int16 WAV.")
        rate = audio.getframerate()
        buffer = PlaybackBuffer(audio.readframes(audio.getnframes()))
    finished = threading.Event()

    def commands():
        for line in sys.stdin:
            if line.strip() == "pause":
                buffer.paused = True
            elif line.strip() == "resume":
                buffer.paused = False
        finished.set()  # Parent exited or closed the pipe.

    def callback(output, frames, _time, _status):
        block, done = buffer.read(frames)
        output[:] = block
        if done:
            raise sd.CallbackStop

    threading.Thread(target=commands, daemon=True).start()
    with sd.RawOutputStream(samplerate=rate, channels=1, dtype="int16", blocksize=512,
                            latency="low", callback=callback, finished_callback=finished.set):
        finished.wait()


def main():
    os.umask(0o077)
    if len(sys.argv) == 3 and sys.argv[1] == "--play":
        play(Path(sys.argv[2]))
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
