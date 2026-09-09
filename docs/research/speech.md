# Speech

Updated 2026-09-09. [Issue #4](https://github.com/marcoazzurrini/pi-dyslexia/issues/4) remains open: automated integration checks pass, but live-Pi end-to-end testing and human listening are unfinished.

## What we chose

**Kokoro through FluidAudio/Core ML, with ALBERT set to `.cpuAndGPU`.** No Python runtime or backend selector. Other model stages keep their default processor settings.

Keep the earlier startup optimization: open playback and silently synthesize `Ready to read.` while Pi responds, then prepare the first speech chunk. Playback waits for the final eligible answer and rechecks text and settings before reusing prepared audio.

Kokoro offers preset voices, native speed control, and synthesis faster than playback. The earlier alternatives did not establish a better overall choice: Pocket TTS delivered streaming audio sooner; the tested VoxCPM2 configuration was slower than real time. No engine won a human quality comparison.

## What the timing means

- **Cold:** the speech engine is not running, but models are already installed. This can happen after launch or cancellation of active synthesis. Installation and downloads are not included.
- **Warm:** the model is loaded, but new speech still needs generation.
- **Prepared:** the first speech chunk and output device are already ready before Play.

There is no inactivity timer that unloads the model. Preparation hides startup; it does not remove it. Short responses can finish before preparation does.

## Measurements

The migration measurements use an **M1 Max, macOS 26.6.2, `af_heart`, speed 1.5**. First-listen tests use four observations per scenario with cached assets.

**Matched cold-start comparison on AirPods Pro:** median estimated first sound was **4.51 s for MLX**, **2.98 s for default FluidAudio**, and **1.79 s for FluidAudio with ALBERT GPU routing**.

**Adopted implementation on Studio Display Speakers:**

| Starting state | Median estimated first sound | Observed range |
| --- | ---: | ---: |
| Manual Play, no workers running | 2.065 s | 2.045–2.140 s |
| Automatic preparation begins immediately before Play | 1.549 s | 1.533–1.559 s |
| Preparation finishes before Play | **0.111 s** | 0.109–0.114 s |

The prepared case excludes **1.425–1.444 s of advance work**. It confirms that the earlier preparation optimization still works.

These are **estimates, not microphone measurements or live-Pi timings**. Only silence reached the device. Estimates subtract muting overhead and add reported device latency plus the original waveform's leading signal. The Studio Display run adds 22 ms device latency and 80 ms leading signal, measured using a 10 ms RMS window above −50 dBFS. Background activity was uncontrolled. Do not compare different output devices as if only the engine changed.

### Other results worth keeping

- ALBERT fell back to CPU under FluidAudio's default settings on this Mac. GPU routing reduced that stage from about **74 ms to 12 ms** and improved initialization.
- Warm synthesis at speed 1.5 was effectively tied: **196 ms optimized FluidAudio versus 197 ms MLX**, across 27 warm samples each. The benefit is not a large warm-throughput lead.
- In a separate speed-1 profiler, sampled process RSS fell from **1,213 MiB to 920 MiB** with targeted routing. This is not peak or total unified memory.
- Bulk PCM encoding reduced about **4.0 ms to 0.42 ms** at speed 1; all 180 checked encodings were byte-identical. This cleanup is adopted.
- **1.57 s was a separate concurrent-manual-start experiment, not the adopted implementation.** It still needs lifecycle and device-change validation.
- Moving every stage to GPU made synthesis slower. Keep the routing change limited to ALBERT. Do not skip pronunciation, weaken offline enforcement, or trim quiet speech to improve a benchmark.

## What still needs checking

The migration passed 17 default tests, three Swift checks, both real native integration tests, and formatting/lint/type checks. Integration covered all five presets at speeds 0.5/1/1.5/2, long input, invalid settings, caching, cancellation/restart, cleanup, and playback controls using silence. The release helper was tested separately; the installed helper and saved preferences were not changed.

Next: test the deployed extension in live Pi, listen for pronunciation and missing/repeated words, and test physical output-device changes. GPU output is not waveform-identical. British presets use the US English pronunciation frontend. Other Macs/OS versions remain unvalidated; review licenses before distributing a bundled runtime.

## Why speech stays optional

Educational studies do not prove benefits for coding work. [Grunér et al.](https://doi.org/10.1177/0162643417742898) found varied comprehension benefits; comfort alone did not establish improvement. [Knoop-van Campen et al.](https://doi.org/10.1007/s11881-021-00246-w) found longer reading times without a significant comprehension change in the tested tasks. Their [navigation study](https://doi.org/10.1007/s11881-022-00271-3) found some changed navigation patterns, not proof of improved learning.

Keep user control and the original answer available. Measure understanding separately from preference. Do not claim reading-skill improvement or universal dyslexia-specific benefit.

[Setup and runtime details](../../extensions/speech/native/README.md). To recheck startup with the installed helper, run `node scripts/benchmarks/speech-first-listen.mjs` using Node.js 24. The [benchmark](../../scripts/benchmarks/speech-first-listen.mjs) opens the current output device with silence and prints a private temporary results directory. It does not install anything or change preferences.
