"""Dependency-free checks for PCM pause/resume."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "speech"))
from worker import PlaybackBuffer

buffer = PlaybackBuffer(b"\x01\x02\x03\x04\x05\x06")
assert buffer.read(1) == (b"\x01\x02", False)
buffer.paused = True
assert buffer.read(2) == (b"\0" * 4, False)
assert buffer.position == 2
buffer.paused = False
assert buffer.read(1) == (b"\x03\x04", False)
assert buffer.read(2) == (b"\x05\x06\0\0", True)
assert buffer.read(1) == (b"\0\0", True)
print("PCM pause/resume checks passed.")
