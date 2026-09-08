"""Dependency-free checks for PCM pause/resume and offline setup readiness."""

from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "speech"))
from worker import PlaybackBuffer, check

buffer = PlaybackBuffer(b"\x01\x02\x03\x04\x05\x06")
assert buffer.read(1) == (b"\x01\x02", False)
buffer.paused = True
assert buffer.read(2) == (b"\0" * 4, False)
assert buffer.position == 2
buffer.paused = False
assert buffer.read(1) == (b"\x03\x04", False)
assert buffer.read(2) == (b"\x05\x06\0\0", True)
assert buffer.read(1) == (b"\0\0", True)
with TemporaryDirectory() as directory:
    path = Path(directory)
    (path / "voices").mkdir()
    for name in ("config.json", "model.safetensors", *(f"voices/{voice}.safetensors" for voice in
                 ("af_heart", "af_bella", "am_michael", "bf_emma", "bm_george"))):
        (path / name).write_bytes(b"test")

    def snapshot(_model, **options):
        assert options["local_files_only"] is True, "startup must never download"
        return directory

    with patch("worker.importlib.util.find_spec", return_value=object()), patch.dict(
        sys.modules, {"huggingface_hub": SimpleNamespace(snapshot_download=snapshot)}
    ):
        check()
        (path / "voices/af_heart.safetensors").unlink()
        try:
            check()
            raise AssertionError("missing voice must require setup")
        except RuntimeError as error:
            assert "/speech setup" in str(error)
    with patch("worker.importlib.util.find_spec", return_value=None):
        try:
            check()
            raise AssertionError("missing dependency must require setup")
        except RuntimeError as error:
            assert "/speech setup" in str(error)

print("PCM pause/resume and offline setup checks passed.")
