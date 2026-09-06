#!/bin/sh
# Explicit, one-time local installation. No audio is played.
set -eu
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'Speech currently requires an Apple Silicon Mac.' >&2
  exit 1
fi
command -v uv >/dev/null || { echo 'Install uv first: https://docs.astral.sh/uv/' >&2; exit 1; }
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
venv="$HOME/.cache/pi-dyslexia/venv"
if [ ! -x "$venv/bin/python" ]; then
  uv venv --python 3.12 "$venv"
fi
uv pip install --python "$venv/bin/python" -r "$root/requirements.txt"
"$venv/bin/python" "$root/worker.py" --download
