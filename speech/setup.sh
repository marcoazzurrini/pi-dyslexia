#!/bin/sh
# Explicit, one-time local installation. No audio is played.
set -eu
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'Speech currently requires an Apple Silicon Mac.' >&2
  exit 1
fi
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
base="$HOME/.cache/pi-dyslexia"
uv=$(command -v uv || true)
if [ -z "$uv" ]; then
  uv="$base/bin/uv"
  if [ ! -x "$uv" ]; then
    echo 'Installing uv from astral.sh (no administrator access or shell profile changes)...'
    installer=$(mktemp)
    trap 'rm -f "$installer"' EXIT
    curl --proto '=https' --tlsv1.2 -LsSf https://astral.sh/uv/install.sh -o "$installer"
    UV_UNMANAGED_INSTALL="$base/bin" sh "$installer"
  fi
fi
venv="$base/venv"
echo 'Preparing Python 3.12...'
if [ ! -x "$venv/bin/python" ]; then
  "$uv" venv --python 3.12 "$venv"
fi
echo 'Installing speech dependencies and the English dictionary...'
"$uv" pip install --python "$venv/bin/python" -r "$root/requirements.txt"
echo 'Downloading and checking the Kokoro voice model...'
"$venv/bin/python" "$root/worker.py" --download
"$venv/bin/python" "$root/worker.py" --check
echo 'Read-aloud setup complete.'
