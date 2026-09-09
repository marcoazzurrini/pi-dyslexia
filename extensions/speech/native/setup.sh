#!/bin/sh
# Explicit setup only. Never play audio or alter saved speech preferences.
set -eu
umask 077
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'FluidAudio currently requires an Apple Silicon Mac.' >&2
  exit 1
fi
if ! command -v swift >/dev/null 2>&1 || ! xcrun --find swift >/dev/null 2>&1; then
  echo 'Install Swift 6 and Apple command-line tools before running FluidAudio setup.' >&2
  exit 1
fi
if [ ! -x /usr/bin/sandbox-exec ]; then
  echo 'FluidAudio requires sandbox-exec to enforce offline inference.' >&2
  exit 1
fi
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
base="$HOME/.cache/pi-dyslexia/native"
mkdir -p "$base/bin" "$base/home"
echo 'Building the pinned Swift/FluidAudio helper...'
swift build --package-path "$root" -c release --product pi-speech --jobs 4 --disable-automatic-resolution
build=$(swift build --package-path "$root" -c release --show-bin-path)
echo 'Downloading and verifying pinned Kokoro and pronunciation assets...'
node --experimental-strip-types "$root/assets.ts" "$base/home"
# SwiftPM resource bundles must accompany the executable at runtime.
for bundle in "$build"/*.bundle; do
  [ ! -d "$bundle" ] || ditto "$bundle" "$base/bin/$(basename "$bundle")"
done
install -m 700 "$build/pi-speech" "$base/bin/pi-speech.tmp"
mv -f "$base/bin/pi-speech.tmp" "$base/bin/pi-speech"
echo 'Verifying assets without network access...'
CFFIXED_USER_HOME="$base/home" PI_DYSLEXIA_NATIVE_HOME="$base/home" OS_ACTIVITY_MODE=disable \
  /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny network*)' "$base/bin/pi-speech" --verify
echo 'Read-aloud is ready. No audio was played.'
