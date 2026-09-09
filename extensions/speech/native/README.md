# Local speech runtime

FluidAudio is the only speech engine. TypeScript owns the existing controls, silent preparation, first-chunk prefetch, cache, and cancellation. One compiled Swift executable runs in two persistent processes: Kokoro synthesis and AVAudioEngine playback. There is no Python dependency, backend selector, or automatic fallback.

## Setup

Requirements: Apple Silicon macOS, Node.js 24, Swift 6, and Apple's command-line tools. Full Xcode is not required for the model-free Swift tests. The pinned FluidAudio package supports macOS 14+, but the routing experiment was measured on an M1 Max with macOS 26.6.2. Upstream reports crashes on macOS 26.4–26.5; support on every Apple Silicon/OS combination is not established.

Run `/speech setup` in Pi, or from this checkout:

```sh
npm run setup:speech
```

Setup builds the pinned dependency and downloads approximately 101 MiB of pinned model, pronunciation, and voice assets. SwiftPM also downloads build dependencies, including a text-normalization binary. Setup does not install a toolchain, request administrator access, change shell profiles, or play audio.

Run setup once after migrating from MLX or the experimental native executable. Readiness requires the current helper's ALBERT routing acknowledgement, so an older executable cannot silently pass. Saved speech preferences remain unchanged. Old Python environments and caches are not deleted or used.

## Model configuration

`Sources/PiSpeech/Entry.swift` changes only ALBERT's compute units to `.cpuAndGPU`. Other stages retain `KokoroAneComputeUnits.default`. On the tested M1 Max, the default CPU/Neural Engine setting falls back to CPU for ALBERT. Allowing the GPU improves initialization and inference; moving every stage to GPU regresses synthesis.

See the [speech decisions and remembered results](../../../docs/research/speech.md). The measurements are not guarantees for every machine. The routing change is not waveform-identical. Human listening, technical pronunciation, and compatibility on other hardware still need assessment. British presets use FluidAudio's US English pronunciation frontend.

The committed background optimization remains: open playback and synthesize `Ready to read.` silently while the agent responds, then prepare the first speech chunk. Manual playback without prior preparation still opens playback after its first WAV is ready. The separate concurrent-manual-start experiment is not adopted here.

## Files and boundaries

- `../runtime.ts`: executable location, setup description, isolated environment, and mandatory network sandbox.
- `setup.sh`, `assets.ts`: explicit installation and verified, resumable asset downloads.
- `Sources/PiSpeech/Entry.swift`: initialization, synthesis requests, and word-boundary retries for model length limits.
- `Sources/PiSpeech/Assets.swift`: offline file checks and SHA-256 verification.
- `Sources/PiSpeech/Protocol.swift`: bounded JSON requests and serialized responses.
- `Sources/PiSpeech/Player.swift`: persistent audio output and render acknowledgements.
- `Sources/SpeechCore/Audio.swift`: bounded PCM conversion, WAV validation, and pause-preserving buffers.

## Runtime and privacy

- `~/.cache/pi-dyslexia/native/bin/` contains the executable and SwiftPM resource bundles.
- `~/.cache/pi-dyslexia/native/home/` is an isolated Foundation home for FluidAudio's pronunciation and model caches. Other applications' caches remain untouched.
- Every runtime invocation uses `sandbox-exec` with network access denied. Missing sandbox support fails readiness. `ModelHub.offlineMode` is also enabled, but some upstream pronunciation download paths bypass it.
- Only explicit setup downloads assets. `assets.json` pins the model revision and every source and installed checksum. Readiness checks file sizes; synthesis startup verifies SHA-256 hashes before loading models.
- Third-party logs are suppressed. Synthesis responses contain numeric IDs and fixed error codes, never input text or underlying exception messages. Protocol output uses a separate file descriptor.
- Synthesis writes private 24 kHz mono PCM16 WAVs. Non-finite audio is rejected. Only exact leading zeros are trimmed, retaining 20 ms before the first nonzero sample. Bulk PCM encoding preserves the previous bytes.
- Long phoneme sequences split at word boundaries. Acoustic-length errors retry shorter sequences. Neither text nor audio is silently truncated.
- Playback keeps an AVAudioEngine source open. Pause retains the sample position. A separate timer reports render acknowledgements outside the audio callback. Device changes invalidate playback so an explicit retry can reopen the output.
- Cancellation terminates only the owned synthesis process. Cached playback and its separate output process remain available. Shutdown kills both processes and removes temporary audio.

## Verification

```sh
npm run check
npm run test:speech-native
npm run test:speech-local
```

`npm run check` uses fake synthesis and playback without downloading models or building Swift. The standalone Swift test executable checks PCM buffering, trimming, exact encoding bytes, and WAV validation without XCTest or inference. The local integration test requires setup; it checks real synthesis and opens the output device, but plays only synthetic silence.

Use the [first-listen benchmark](../../../scripts/benchmarks/speech-first-listen.mjs) for new startup measurements. Keep important findings and their limitations in [speech research](../../../docs/research/speech.md), not separate reports or raw-result collections.

## Updating dependencies

FluidAudio is pinned to `9dfb81b9535e119f855f9ec9c98308ea6076cc95` in `Package.swift` and `Package.resolved`. The model repository is pinned to `acac8811a9acefe8bf7a5e3fcba99bd8fc50dcd6` in `Sources/PiSpeech/Resources/assets.json`.

The model graphs accept `style_s` and `style_timbre` inputs. Four additional voice packs are converted from the same repository's JSON into row-major float32 binaries. Row indexing was checked against upstream `af_heart.bin` byte for byte.

`scripts/lock-speech-assets.mjs` regenerates the reviewed asset manifest. Update its revision intentionally, inspect the selected files, and rerun checks. Do not follow remote `main` during setup or inference.

FluidAudio, the published Kokoro conversion, and the linked `text-processing-rs` project declare Apache-2.0 licenses. Keep upstream attribution and review model and transitive licensing before distributing prebuilt binaries. This repository ships helper source and the lock file, not model weights or a prebuilt executable.
