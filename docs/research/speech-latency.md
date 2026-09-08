# Speech onset latency investigation

Investigated 2026-09-08. Baseline runtime source: `316cd4147c5995b1f5c4ed372c84afb23e191c22` (v0.4.0). The initial investigation changed no runtime behavior. The subsequently approved changes and new measurements appear under [Implementation follow-up](#implementation-follow-up). Baseline source line numbers below refer to that recorded revision.

## Conclusion

The delay is mostly work that starts too late, not slow steady-state synthesis. The extension waits until the agent settles before starting Python, loading the model, initializing pronunciation, generating the first WAV, and opening the audio device.

Measurements explain approximately **4.2 seconds before a short first sentence becomes audible**, excluding Pi's finalization delay and unmeasured hardware effects. This is consistent with the reported roughly five-second wait, but is not a direct measurement of that particular response.

Warm synthesis alone is fast: **95 ms** for a short sentence at the current 1.5× setting. However, every chunk opens a new playback process and audio stream, costing another **508 ms** before its first callback. Generated speech also has a quiet lead-in. Preloading only the model will therefore not make playback instant.

**Recommended order:** warm the complete synthesis path during the agent's response; keep the output stream open; then prepare the first sentence before completion and remove only verified initial silence. Keep actual playback gated on `agent_settled`.

## What was checked

- Current Mac: **Apple M1 Max, 32 GiB RAM**, macOS 26.6.2, Python 3.12.14, Pi 0.85.1. The earlier engine comparison described a different machine; do not treat its figures as current measurements.
- Current saved settings: `af_heart`, speed `1.5`, automatic playback on, prose only.
- Default output during measurement: **Studio Display Speakers**, not Bluetooth headphones.
- The installed Git package and this checkout have identical speech sources and `package.json`. This is not an installed-version mismatch.
- No synthesis worker was alive at the initial process inspection. That is consistent with a cold next request; it does not establish how every previous response behaved.
- MLX-Audio 0.5.1, MLX 0.32.2, Misaki 0.9.4, spaCy 3.8.16, sounddevice 0.5.6.

## The baseline critical path

1. [`speech/index.ts:304`](../../speech/index.ts#L304) waits for `agent_settled`, verifies an eligible completed answer, and calls `player.start()`.
2. [`speech/text.ts:5`](../../speech/text.ts#L5) renders Markdown and segments sentences. Long sentences can reach 500 code points.
3. [`speech/audio.ts:115`](../../speech/audio.ts#L115) checks the cache and lazily starts the synthesis worker. Session startup only checks installed files; it does not warm this worker.
4. [`speech/worker.py:39`](../../speech/worker.py#L39) loads dependencies and model weights. The pronunciation pipeline is created lazily inside `generate()` at line 59.
5. The worker finishes the entire first chunk and closes the WAV before replying. This is not sample-level streaming.
6. [`speech/audio.ts:176`](../../speech/audio.ts#L176) starts another Python process for playback. [`speech/worker.py:120`](../../speech/worker.py#L120) opens a new PortAudio output stream.
7. The audio device consumes the first buffers, including any quiet samples at the beginning of the generated speech.

There is no five-second sleep or debounce in this path. The 120-second synthesis timeout is a failure deadline, not an intentional delay.

The next-chunk prefetch in [`speech/player.ts:112`](../../speech/player.ts#L112) already overlaps synthesis with playback. It does not prepare the first chunk, and it does not eliminate playback-device startup between chunks. Replay caching also already exists; increasing the cache will not help novel answers.

### Why cold starts recur

[`speech/audio.ts:139`](../../speech/audio.ts#L139) kills the synthesis worker when active inference is cancelled. New submitted prompts call `player.stop()`, which aborts both playback and any active prefetch. The next uncached request then initializes again. `/speech off`, session replacement, reload, and shutdown also unload the worker.

Stopping playback does **not** always kill the model: if generation has already completed, its abort listener has been removed. A repeated five-second delay after uninterrupted warm playback would therefore require additional investigation, not an assumption that every stop reloads the model.

### Pi finalization is a separate interval

Installed Pi 0.85.1 awaits message/turn/agent extension handlers and post-run retry/compaction checks before emitting `agent_settled`. There is no unconditional five-second delay in the inspected normal path. The inspected Ponytail `agent_end` handler updates status; context-mode's `turn_end` handler writes a usage event. Their live durations were not measured.

Do not replace the playback trigger with `message_end` or `agent_end` merely to bypass this interval. A message can still be followed by tools, queued prompts, retries, or compaction. Earlier events are suitable for **silent preparation**, with validation at settlement, not unconditional narration.

## Measurements

The new [benchmark](benchmark-speech-latency.py) instruments the shipped worker in fresh processes with cached assets. It runs three cold trials, then three warm passage sizes in each process. All synthesis remains offline and uses fixed synthetic text. Playback tests use only synthetic silence; no microphone or conversation transcript is accessed.

[Raw results](speech-latency-results.json) retain individual timings, passages, versions, and timestamp. These are small engineering samples, not p95 estimates. “Cold” means a fresh process, not a cold filesystem cache or first-ever installation.

| Stage | Current measurement |
| --- | ---: |
| Fresh process to first WAV, 34 characters | **3,373 ms median**, 3,318–3,448 ms |
| Model/dependency loading within that cold request | **1,012 ms median** |
| Warm generation, 34 characters | **95 ms median** |
| Warm generation, 90 characters | **196 ms median** |
| Warm generation, 491 characters | **782 ms median** |
| Fresh playback process, child start to first callback | **508 ms median** |
| Playback imports within that interval | **64 ms median** |
| Reused playback process, but new output stream | **444 ms median** across six stream openings |
| First callback's reported time until DAC output | Approximately **35 ms** |
| Generated samples before first amplitude ≥ −40 dBFS | **240–325 ms**, depending on passage |

The 90-character input contains two sentences passed as one worker request; the normal renderer can split it. The 491-character input is one sentence and exercises the existing long-chunk ceiling.

Adding representative medians gives roughly **4.2 seconds cold**, **0.9 seconds warm for the short sentence**, and **1.6 seconds warm for the long sentence**. These are a latency budget, not measured acoustic onset. Parent process creation, Pi finalization, device behavior, and a perceptual definition of “audible” remain outside that sum or approximated.

### Additional focused probes

A separate fresh-process probe split the lazy initialization further:

- `worker.load()`: **1,006 ms**.
- `model._get_pipeline('a')`: **2,194 ms**.
- First generation after explicit pipeline initialization: **128 ms**.

This identifies pronunciation-pipeline initialization as the largest cold component in that probe. **Importing Python or calling `load()` alone is insufficient.** Warm the selected language pipeline, preferably by generating one short silent-to-the-user sample through the real synthesis route. These stage figures are one exploratory trial, not the medians above.

A direct Node `LocalAudio` probe measured **3,459 ms cold**, **86 ms warm**, and **0.009 ms for a cache hit**. Cancelling active generation removed the worker; the next request took **3,384 ms**. Markdown rendering/segmentation averaged **0.68 ms** over 100 iterations of a roughly 6 KiB synthetic answer. Neither Markdown optimization nor cache lookup optimization is a meaningful first target.

The warning sample's first nonzero int16 sample occurred at **186 ms**; its first sample above −60 dBFS occurred at **238 ms**, and above −40 dBFS at **252 ms**. Thus the lead-in is not purely device delay. **The −40 dBFS measurement is not a safe trimming rule:** quiet consonants must survive.

## Improvements, ranked

### 1. Warm synthesis while the agent is working

Start background preparation at `agent_start` when speech is installed, automatic playback is enabled, and no setup/error block applies. Do not await it in the event handler. Reuse the existing worker and synthesis queue; do not add a server or another model instance.

Warm the selected language/voice through one short generated sample without playing it. Calling the readiness check or loading weights alone misses the expensive pronunciation initialization. Repeat preparation after a cancelled worker and when a newly selected language pipeline needs initialization. Keep `/speech off` and shutdown authoritative, and do not warm in headless modes.

Expected benefit on this Mac: hide approximately **3.3 seconds** when the agent runs long enough. A very short response can still beat warm-up. Retaining the model consumes memory and power; this extends the existing warm-worker lifetime rather than making it free.

**This is the smallest high-impact change. It likely reduces a cold wait to around one second, not instant playback.**

### 2. Keep the audio output stream open, not just Python

Use one owned playback process with one open stream for the narration interval. Prepare it while the agent runs, then feed completed chunks to that stream. Keep silence while paused or waiting without advancing the speech position. Preserve immediate stop and device-error handling.

The reused-process experiment still costs **444 ms** when opening a new stream. Merely persisting Python saves about 64 ms and misses the main cost. Keeping the stream open also removes this repeated startup cost between sentences.

At the current 512 frames / 24 kHz setting, a callback interval is about **21 ms**, with approximately **35 ms** reported downstream latency on this output. Those are useful limits for a prepared stream, not a guarantee for Bluetooth or every device. Release the stream on off/shutdown and handle device changes. Avoid an always-running global audio daemon.

### 3. Prepare the first sentence before settlement

If the target remains perceived instant onset, silently synthesize one stable first chunk during `message_update`, while the rest of the answer streams. A simpler first experiment can prepare at successful `message_end`, but that event may leave almost no time before settlement.

At `agent_settled`, re-render the final answer and use prepared audio **only if** the first chunk, voice, speed, content mode, and current run still match. Otherwise discard it and take the existing safe path. Never play partial, failed, aborted, tool-calling, or superseded answers. Markdown can change interpretation as more text arrives; matching the final rendered chunk is essential.

Keep this bounded to the first chunk. Do not add a second speech queue for the whole answer. This overlaps another **95–782 ms** for the measured inputs, but cannot guarantee preparation time for one-word answers or text that arrives in one burst.

### 4. Remove only verified initial silence

Measure and trim exact leading silence with a small safety margin first. The sampled warning contains about **186 ms** before any nonzero PCM sample. Do not blindly cut 250 ms or use the diagnostic −40 dBFS threshold as a speech detector.

If more aggressive trimming becomes necessary, listening checks must cover quiet initial consonants, all offered voices, speeds, warnings, identifiers, and numbers. Preserve internal pauses and wording. Without addressing the generated lead-in, even precomputed speech on an open device can retain a roughly quarter-second perceived wait.

### Not first priorities

- **Smaller chunks:** helpful for a long first sentence, but not the multi-second initialization. Prefer a natural clause boundary over indiscriminate short fragments; check prosody and negation.
- **Faster speed:** already 1.5× and primarily a reading preference. Do not change it to hide a startup problem.
- **Different engine:** prior Pocket results suggest lower synthesis first-chunk latency, but do not remove our audio-device startup or lifecycle delays. Fix scheduling and playback before repeating engine selection.
- **Bigger cache, faster Markdown, smaller buffers, or a native rewrite:** the measured dominant costs are elsewhere. Smaller buffers will not remove a 444 ms stream-opening cost.
- **Changing “loading” text:** useful feedback, not a latency fix. The current player marks itself `playing` immediately after process spawn, roughly half a second before the measured first callback. A first-buffer acknowledgement would make status and timing more honest.

## Acceptance and remaining uncertainty

Use **≤150 ms from final visible text to audible speech** as a proposed engineering target, not an established universal perception threshold. The complete prepared path may approach that on this output, but it has not been implemented or measured. Warm-up alone cannot meet it.

Before calling the result instant, record monotonic timestamps for last text update, successful message end, `agent_settled`, synthesis request/worker state, WAV readiness, playback request, and first output callback. Record numeric timings only, not text. Measure the device separately; callback time is not acoustic time.

Check at least 20 normal completions and report median, p95, and maximum. Separate cold, warm, cancelled/restarted, short/burst responses, long first sentences, voice changes, and output devices. Include pause/stop, queued follow-ups, errors, tree navigation, off, and shutdown regression checks. An actual listening or loopback onset check requires explicit agreement; none was performed here.

If warm, uncancelled turns still take five seconds, the next evidence needed is the live Pi finalization interval and device onset, rather than another model optimization.

## Reproduction and checks

```sh
~/.cache/pi-dyslexia/venv/bin/python docs/research/benchmark-speech-latency.py --playback \
  > docs/research/speech-latency-optimized-results.json
```

Omit `--playback` to avoid opening the output device. Add `--speed 1` to compare normal synthesis speed. The benchmark validates worker responses and nonempty audio and cleans up temporary WAVs and owned children.

During the baseline investigation, the benchmark completed successfully and `npm test` reported **10 passed, 1 failed, 1 skipped**. The failure is the existing writing-policy assertion in `test/dyslexia.test.mjs`: it expects the Rules opening to contain `including research`, while the unchanged `SKILL.md` does not. The skipped test is the opt-in local speech integration test. No production code, settings, or installed package was modified during that initial investigation.

The Python benchmark now exercises the new persistent-player protocol. The original `speech-latency-results.json` remains the baseline artifact; do not overwrite it with results from the changed runtime.

## Implementation follow-up

Implemented locally after approval, 2026-09-08. No new runtime dependencies, cloud service, microphone, or transcript logging were added. The installed Git package and saved settings remain unchanged; these source changes still need deployment and reload before affecting the owner's normal Pi session.

### Changes

- At `agent_start`, installed and enabled automatic speech warms the real pronunciation/inference path and opens its output stream without awaiting either in the Pi handler. A generated warm-up sample is deleted and never played.
- Streaming preparation waits for at least two rendered chunks, then prepares only the first chunk. Completed short messages can prepare at `message_end`. Only one speculative request can be in flight; there is no growing speculative backlog.
- Settlement transfers the existing preparation controller rather than aborting it. The final rendered chunk, voice, speed, and content mode must match before reuse. A mismatch uses the normal synthesis path. Partial, failed, aborted, tool-calling, and superseded responses still never trigger narration.
- A dedicated player process uses one open PortAudio stream. JSON commands select, pause, resume, or stop the current buffer. The callback only moves PCM and queues numeric acknowledgements; a separate thread writes those acknowledgements. Readiness and the playing state wait for actual output callbacks.
- Only exact initial zero samples are removed, retaining 480 samples (20 ms) before the first nonzero sample. No threshold-based trimming, word removal, or internal-pause trimming is used.
- Stop cancels preparation and suppresses automatic narration of the current agent run. Auto-off cancels silent preparation without interrupting an already playing answer. Off/shutdown close the owned processes. Runtime playback errors invalidate the player so an explicit retry can open a new stream.

### Results after the changes

The default output changed from the baseline's Studio Display Speakers to **AirPods Pro** during development. The final integrated benchmark records AirPods Pro both before and after its run. Do not attribute cross-device differences to the code alone.

[Integrated results](speech-onset-results.json) use the real `SpeechPlayer`, `LocalAudio`, synthesis worker, and playback protocol. The benchmark replaces the audible waveform with synthetic silence but separately measures the generated WAV's lead-in. It simulates settlement with `player.start()`; it does not drive a live Pi agent. All twenty prepared cases finish preparation before that simulated settlement.

| Case | Trials | Start to first-buffer acknowledgement, median | p95 | Estimated audible-threshold onset, median |
| --- | ---: | ---: | ---: | ---: |
| Cold, no preparation | 3 | 3,976 ms | 3,976 ms | 4,234 ms |
| Warm worker and stream, no first-chunk preparation | 3 | 149 ms | 149 ms | 380 ms |
| First chunk and stream prepared | 20 | **11.4 ms** | **20.6 ms** | **253 ms** |

Prepared first-buffer maximum was **20.7 ms**. Estimated threshold onset was **264 ms p95**, **282 ms maximum**. The estimate adds the acknowledgement delay, PortAudio's reported downstream delay, and the generated samples before the first amplitude of at least −40 dBFS. This is not measured acoustic onset or a validated definition of perceptual instantaneity.

AirPods reported approximately **173 ms** of downstream delay; generated lead-in after conservative trimming was approximately **68–90 ms** in the prepared passages. The current output device therefore exceeds the proposed 150 ms target before software overhead and quiet speech are counted. The extension's prepared path is now approximately one callback interval, but a promise of acoustically instant playback on these headphones would be false. A lower-latency wired or built-in output is the next comparison; the benchmark never changed the owner's selected device.

[Worker-level results](speech-latency-optimized-results.json) separately confirm the persistent-stream protocol and shortened WAV lead-in. Cold synthesis remains expensive: the improvement comes from performing it before completion, not pretending model initialization disappeared.

### Checks and remaining limits

- Speech/rendering/setup unit tests: **10 passed**.
- Local integration: passed real warm-up, worker cancellation/restart, cache and permissions, exact-zero trimming, silent pause/resume/stop, stream reuse, invalid-file recovery, cancellation during device startup, and cleanup.
- Strict TypeScript checking against installed Pi 0.85.1: passed.
- Full default suite: **13 passed, 0 failed, 1 skipped**. At the owner's request, the two outdated exact-wording assertions were removed from the writing-policy test. Functional behavior checks remain; the writing policy itself is unchanged.
- No live Pi lifecycle timing or human listening test was performed. Very short/burst responses can outrun preparation and still incur a cold wait. The open stream retains its selected device; `/speech off` followed by `/speech auto on` reopens the default output after a device switch when needed. Device buffering also limits pause/stop responsiveness.

Reproduce the integrated check (only silence is played):

```sh
node --experimental-strip-types docs/research/benchmark-speech-onset.mjs \
  > docs/research/speech-onset-results.json
```

Next validation is a normal Pi session using the deployed source: compare the final visible token with audible speech, including a short answer, a long answer, cancellation, and the preferred output device. Do not call the complete user-perceived path instant solely from these callback measurements.
