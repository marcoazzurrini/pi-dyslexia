# Local speech for Pi answers

Research and implementation notes for [issue #4](https://github.com/marcoazzurrini/pi-dyslexia/issues/4). Updated 2026-09-07.

**Status: working development prototype with local measurements, not a completed accessibility evaluation.** The owner approved implementation after reviewing the initial design. Kokoro + MLX-Audio is selected for the trial. Human listening comfort, pronunciation, omissions/repetitions, and realistic long-answer performance remain unmeasured. Keep #4 open.

## Earlier research recovered

The Pi conversation from 2026-09-06 provisionally recommended **Kokoro-82M v1.0 with MLX-Audio**, kept loaded between requests on the owner's M1 Pro / 16 GB Mac. The recommendation existed in conversation history, not a committed speech research file.

The shortlist was Kokoro, Pocket TTS, VoxCPM2, and a downloaded macOS voice. Kokoro was preferred for its size, preset voices, and synthesis-speed control. Pocket was the latency challenger; VoxCPM2 was the quality and language-coverage challenger. None had been measured locally at that point.

The earlier discussion mentioned estimated English word timings in Kokoro's Python pipeline. That does not establish equivalent timing support in MLX-Audio or JavaScript. Word highlighting remains deferred.

## Primary evidence: assistance is not skill improvement

This is a targeted review of three primary studies, not a systematic review. Searches covered text-to-speech, dyslexia, reading comprehension, and navigation. The studies concern educational reading, not coding work. Two papers come from the same research group. They do not establish that a particular neural voice, automatic playback, or this extension benefits every dyslexic reader.

### Grunér, Östberg, and Hedenius (online 2017)

*The Compensatory Effect of Text-to-Speech Technology on Reading Comprehension and Reading Rate in Swedish Schoolchildren With Reading Disability*. [DOI](https://doi.org/10.1177/0162643417742898); [full text](https://tortalk.se/wp-content/uploads/files/journal_of_set1-13.pdf). Inspected the abstract, methods, results, and limitations, pp. 1–10.

A randomized crossover study included 49 children with reading disability: 31 in grades 3–5 and 18 in grades 6–9. TTS with word marking was compared with **the children reading aloud themselves**, not silent reading. Participants chose a comfortable TTS rate after practice; pronunciation errors in the test material were corrected beforehand.

Mean comprehension across the sample was 62.4% without TTS and 70.3% with TTS. The younger group improved significantly; no significant improvement was found in the older group. Reading took less time with TTS in both groups. However, 14 of 49 children had lower comprehension with TTS, and about half of those children still reported that TTS felt easier.

**Limits:** Small groups; grade was confounded with text genre, with narrative texts for younger participants and factual texts for older participants. ADHD symptoms were assessed by a questionnaire, not a full clinical assessment. Oral reading is not a fair proxy for normal silent coding work. This measures compensation while the aid is available, not lasting improvement in unaided reading.

**Product implication:** Let the owner choose rate and voice, and measure understanding separately from comfort. Do not use a preference rating alone as proof of benefit.

### Knoop-van Campen et al. (2022), secondary-school reading

*The effect of audio-support on strategy, time, and performance on reading comprehension in secondary school students with dyslexia*. [Full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC9187546/); [DOI](https://doi.org/10.1007/s11881-021-00246-w). Inspected abstract, methods, results passages, and discussion passages.

The study recruited 43 eighth-grade students; 35 remained in eye-tracking analyses after exclusions, including 18 with dyslexia. Students completed different reading tasks with and without narrated text in a within-participant design. Audio encouraged attention across the whole text rather than selective reading for some tasks, increased reading time in most tasks, and did not significantly change comprehension. Audio controls existed, but more than 72% of students never used them.

**Limits:** Small Dutch school sample and task-specific materials. A null result does not establish equivalence. These are not developer conversations.

**Product implication:** Keep replay, stop, and earlier-answer selection visible. Do not assume linear narration is always the fastest way to find an answer, or that merely supplying controls ensures they will be used.

### Knoop-van Campen et al. (2022), navigation

*Impact of audio on navigation strategies in children and adults with dyslexia*. [Full text and DOI](https://doi.org/10.1007/s11881-022-00271-3). Inspected experiment methods, results, and general discussion passages.

Two experiments examined 82 children and 85 university/applied-university students; 36 children and 41 adults had dyslexia. Adults used more linear navigation and fewer combined revisiting patterns when narration was added. Audio did not change children's navigation patterns. Group differences between dyslexic and nondyslexic participants were not found for the reported navigation effects.

**Limits:** The adult data reused participants from an earlier study; this is not independent replication of that earlier result. Navigation patterns were interpreted as reflecting self-regulation, not a direct measurement of every aspect of self-regulation. The authors did not establish a causal relationship between these navigation patterns and learning outcomes here.

**Product implication:** Preserve the original answer and access to earlier material. No forced progression, fading, attention tracking, or reading-training claims.

## Local benchmark

### Method and artifacts

Hardware: **Apple M1 Pro, 16 GiB RAM, macOS 26.6.2**. Python 3.12.8. Engines ran sequentially, not concurrently. The same three fixed English technical passages appear in [`benchmark-speech.py`](benchmark-speech.py). They cover a warning, an error identifier, a port number, uncertainty, a percentage, a filename, a command, and a technical term.

Each engine generated three passages in three trials. Kokoro and macOS also generated them at 1.25 and 1.5 synthesis-rate settings. Pocket and VoxCPM2 were generated at their default rate; fixed trial-0 samples were additionally processed with FFmpeg `atempo=1.25` and `atempo=1.5` for later listening. Those are playback transformations, not native synthesis controls or new generation benchmarks.

- [`speech-results.json`](speech-results.json) records the individual measurements, summaries, core versions, complete observed Python environment, and cached model revisions.
- Audio and per-engine metadata remain under `~/.cache/pi-dyslexia/benchmarks/{kokoro,pocket,voxcpm,macos}/`. Only public synthetic passages were used, not conversation text. No audio was played during the benchmark.
- Warm medians below use trials 1 and 2: six observations per engine/rate. The first trial is retained in the raw data.
- “Cold” means the first generation in a fresh process with downloaded assets already cached. It is not a fresh-machine or cold-disk measurement. The sequence was not randomized, seeds were not fixed, and one final process-cold sample per engine is insufficient for robust cold-start estimates.
- First-chunk readiness is **not acoustic onset**. Pocket yields small streaming chunks; Kokoro and the tested VoxCPM2 path yield a completed segment. The macOS path writes a whole file through `say`. These different boundaries matter when comparing latency.
- The earlier Kokoro exploratory run took about 31 seconds including first-ever library initialization. A later run took 6.55 seconds, and the final recorded run took 3.91 seconds. Caching and initialization clearly affect first use.

### Results at default rate

| Engine / tested voice | Process-cold first chunk | Warm first chunk, median | Warm generation, median | Audio / generation time, median |
| --- | ---: | ---: | ---: | ---: |
| Kokoro bf16 / `af_heart` | 3.915 s | 0.387 s | 0.387 s | 17.78× |
| Pocket TTS / `alba` | 2.211 s | 0.054 s | 1.334 s | 4.45× |
| VoxCPM2 8-bit / default voice, 10 steps | 15.026 s | 10.109 s | 10.118 s | 0.68× |
| macOS / Samantha, 175 wpm baseline | 1.103 s | 0.787 s | 0.787 s | 7.43× |

Kokoro's warm median generation time was 0.341 s at rate 1.25 and 0.278 s at rate 1.5. Median generated duration changed from 6.9 s to 5.85 s and 4.4 s. A synthesis-speed value is not an exact time-stretch multiplier.

Peak measured process RSS was about 812 MB for Kokoro, 1,028 MB for Pocket, and 3,257 MB for VoxCPM2. MLX separately reported peak Metal allocations of approximately 2.25 GB for Kokoro and 6.65 GB for VoxCPM2. **Do not add RSS and Metal values:** they measure different, potentially overlapping allocations. The macOS benchmark's small parent-process RSS excludes the speech service, so it is not a usable estimate of the macOS engine's memory.

Cached downloads occupied approximately 342 MiB for Kokoro, 216 MiB for Pocket's non-cloning model, and 3.0 GiB for VoxCPM2 8-bit. The initial Kokoro Python environment occupied about 1.1 GiB before the small benchmark-only additions. “82M model” does not mean the entire installed stack is tiny.

### Decision and limitations

Use **Kokoro + MLX-Audio for the prototype**. It comfortably outpaced playback for these short passages and has direct rate and preset-voice controls. Pocket is a credible alternative and clearly won first-chunk latency; it should remain in the listening comparison. VoxCPM2's tested configuration was slower than real time and does not suit immediate narration on this Mac. This does not rule out different quantization, steps, runtime, or hardware.

This is an engineering trial decision, **not a finding that Kokoro is the most comfortable or accurate voice**. No human has yet scored these samples. The benchmark did not verify pronunciation, missing/repeated words, longer answers, sustained thermal load, device-switch behavior, or end-to-end acoustic delay. It used one primary voice per engine; five Kokoro presets were separately smoke-tested, not compared for comfort. Sentence-sized generation may affect prosody.

VoxCPM2 produced a Transformers model-type warning during loading but returned audio. Keep that warning in the evaluation record; do not silently treat the configuration as fully validated. Pocket and VoxCPM2 faster playback samples have not been assessed by the owner. The JavaScript Kokoro alternative was inspected but not benchmarked or shipped.

### Reproduction

```sh
npm run setup:speech
uv pip install --python ~/.cache/pi-dyslexia/venv/bin/python soundfile==0.14.0
~/.cache/pi-dyslexia/venv/bin/python docs/research/benchmark-speech.py kokoro
~/.cache/pi-dyslexia/venv/bin/python docs/research/benchmark-speech.py macos
```

Pocket is a benchmark-only install, not a runtime dependency. Its setup requires a one-time online call to `TTSModel.load_model()` and `get_state_for_audio_prompt("alba")` after installing `pocket-tts==3.1.0`. VoxCPM2 requires explicitly downloading `mlx-community/VoxCPM2-8bit` at revision `d52725898a0675703f7f9ddc5a4d1a3cdbb99032`. Then run the same script with `pocket` or `voxcpm`. Benchmark runs set Hugging Face/Transformers offline flags.

To prepare a pitch-preserving faster listening sample:

```sh
ffmpeg -i sample.wav -af atempo=1.25 sample-1.25.wav
```

## Runtime, licensing, and offline verification

Selected versions: MLX-Audio 0.5.1, MLX 0.32.2, Misaki 0.9.4, spaCy 3.8.16, `en_core_web_sm` 3.8.0, sounddevice 0.5.6, and Kokoro snapshot `a71e4d38b236d968966a2002c4c895dbd12b1c3c`. Core dependencies are pinned in `speech/requirements.txt`; the observed full environment is recorded in the results artifact. Transitive dependencies are not fully locked by the setup script.

Sources inspected include the [MLX-Audio README](https://github.com/Blaizzy/mlx-audio), installed Kokoro model/pipeline source, [Kokoro JavaScript README](https://github.com/hexgrad/kokoro/blob/main/kokoro.js/README.md), [Pocket README](https://github.com/kyutai-labs/pocket-tts), and [VoxCPM2 MLX README](https://github.com/Blaizzy/mlx-audio/blob/main/mlx_audio/tts/models/voxcpm2/README.md).

License checks are separate from model selection:

- The selected [Kokoro conversion](https://huggingface.co/mlx-community/Kokoro-82M-bf16) and [VoxCPM2 conversion](https://huggingface.co/mlx-community/VoxCPM2-8bit) declare Apache-2.0 in their model metadata. The Kokoro upstream weights also declare Apache-2.0.
- MLX-Audio, MLX, sounddevice, and the English spaCy model declare MIT in installed metadata. Misaki includes Apache-2.0 license text.
- **The pronunciation stack is not entirely permissively licensed.** `phonemizer-fork` 3.3.2 includes GPLv3 text and declares GPLv3-or-later. The eSpeak NG component is GPL-covered; `espeakng-loader` 0.2.4 had no license declaration or license file in its installed distribution metadata. Resolve the loader's bundled-binary notices and redistribution obligations before distributing a bundled Python runtime. Do not describe the whole stack as Apache-2.0.
- Pocket TTS 3.1.0 code includes MIT-style permission text. The actually downloaded [non-cloning weights](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning), revision `e81d79e8194ad4c7ce879c87a4258ef20cbf2487`, declare **CC-BY-4.0**, not the code's license. Separate voice assets may have their own terms. This prototype does not redistribute them.
- The macOS voice belongs to the operating system; it is not bundled. Markdown dependencies `marked` and `entities` are declared npm dependencies, with versions locked in `package-lock.json`.

The extension ships no model weights or Python environment. Setup is an explicit online action. Ordinary synthesis enforces offline flags, resolves the pinned local snapshot, checks the English dictionary before constructing the pipeline, uses absolute cached voice paths, and refuses to run without the pronunciation fallback rather than silently skipping unknown words.

**OS-level check:** all five offered presets generated a fixed warning sentence inside `sandbox-exec` with `(deny network*)`. This verifies the selected installed path can synthesize without network access, not that every future dependency version is incapable of networking. No HTTP server, cloud fallback, microphone listener, or transcript log is used.

## Implemented playback design

The new `speech/index.ts` entry point is independent of the writing policy. It requires the documented APIs in Pi 0.85.1 or newer. The installed extension/TUI/keybinding/session-format documentation and the `status-line.ts` example were inspected, and both entry points passed the installed Pi extension loader.

- `/speech auto on|off` is a saved preference. Following the owner's later request, automatic playback now defaults to on when Pi opens, superseding #4's original manual-default proposal. An explicitly saved off preference remains off. Invalid or unreadable settings fall back to manual playback. This does not change `/dyslexia` behavior or narrate restored history.
- `/speech` plays the selected answer, falling back to the latest answer before any selection. During playback/loading it pauses; when paused it resumes. `/speech latest` explicitly switches to a newer answer.
- `/speech replay`, `previous`, `stop`, `answers`, `speed`, `voice`, `preview`, `include`, `off`, `status`, and `help` provide direct controls without an LLM turn. Previous moves by a speech chunk, usually a sentence.
- `Ctrl+Alt+S`, `Ctrl+Alt+R`, and `Ctrl+Alt+X` provide play/pause, replay, and stop. A small widget offers clickable controls in fullscreen mode. Regular mode does not capture mouse input, so commands/shortcuts remain essential. Existing footer and editor components are not replaced.
- Automatic narration uses `agent_settled`, a current-run boundary, and successful assistant messages only. It excludes thinking, tool calls/results, partial/aborted/errored/length-limited responses, duplicate events, and restored history. A newer answer does not interrupt a playing or paused answer. There is no automatic backlog.
- New submitted prompts stop playback. Session shutdown/reload/replacement and tree navigation cancel current work. Earlier answers are read from the current Pi session branch, not duplicated into a speech database. Print, JSON, headless, and RPC runs never start audio.
- A persistent Python subprocess performs synthesis. A **separate sounddevice/PortAudio subprocess** plays each chunk. Pause keeps the PCM position and sends silence without advancing it; resume continues there. Stop kills owned playback immediately, subject to the small device buffer. No `SIGSTOP` approximation is used for audio pause.
- Only one following chunk is prefetched. Cached audio is bounded to 32 MiB per Pi instance; keys include text, voice, and speed. Rate/voice changes invalidate incompatible prefetched audio before it plays. The model remains warm after successful narration. `/speech off` unloads it and disables automatic playback.
- MLX has no per-request cancellation in the tested path. Cancelling active generation kills that worker; cached replay remains available, but the next uncached request incurs initialization again. Synthesis has a 120-second timeout. Device errors are reported without blocking Pi's normal use.
- Settings are saved atomically to `~/.pi/agent/pi-dyslexia/speech.json`. The base directory comes from Pi's `getAgentDir()`, respecting `PI_CODING_AGENT_DIR`, as in Pi's `preset.ts` example. The legacy `~/.config/pi-dyslexia/speech.json` is read only when the new file is missing; the next preference change saves to the new path without modifying the old file. WAV files use a private temporary directory and restrictive permissions. Eviction and normal shutdown remove them. A hard crash or `SIGKILL` may leave temporary files behind; there is no unsafe broad temporary-directory sweep. Multiple Pi windows have independent players and can overlap; coordination is deferred.

### Faithful text handling

`marked` parses Markdown instead of a regex stripping pass. Prose, headings, lists, inline identifiers, negation, quantities, and conditions are retained. Tables are read row by row; deleted text is identified as deleted. Code blocks and URL destinations are skipped with explicit spoken announcements by default. `/speech include all` includes them on replay. Link labels remain audible, image descriptions are identified as descriptions, and raw HTML is identified as markup. The original message and executable text never change.

English sentence segmentation uses `Intl.Segmenter`, with protection against splitting inside URL query strings. Long sentences are capped at 500 code points per chunk; that can create unnatural boundaries in long identifiers. Code syntax should be copied from the original, not reconstructed from pronunciation.

Sentence highlighting was considered but is not needed for the first playback milestone. Add it in an optional reader driven by the **playing** chunk, not inference completion. Word highlighting requires verified timing support and is not promised.

## Checks and remaining work

Completed checks:

- `npm test`: writing-policy/package checks plus fake synthesis/playback tests for faithful rendering, stable pause/resume, replay, cancellation, stale results, bounded prefetch, speed changes, errors, settings validation, final-answer gating, history, tree changes, and headless exclusion.
- `npm run test:speech-local`: real offline worker/cache/cancellation/restart, cache eviction, restrictive WAV permissions, sample-position pause/resume checks, silent native playback, and normal cleanup. Only synthetic silence is played.
- Strict TypeScript checking against the installed Pi types; installed extension-loader smoke check; `npm pack --dry-run` confirms source/setup inclusion and excludes Python caches, model weights, and environments.
- OS-denied networking synthesis with all five presets. Clickable widget behavior and keyboard conflicts still need an interactive owner check; a component/loader test is not a human UI test.

Next work remains under #4 rather than opening duplicate benchmark issues:

1. Blind-listen to the saved Kokoro, Pocket, VoxCPM2, and Samantha samples at normal and faster rates. Record accuracy, omissions/repetitions, effort, and preference separately; check understanding of warnings and conditions.
2. Try the prototype during actual coding. Test returning after narration ends, pause during loading, replay, earlier answers, session switching, and audio-device changes. Measure end-to-end onset and long-answer behavior under normal machine load.
3. Keep or change the selected engine based on those results. Close the licensing/provenance gap before any bundled-runtime distribution. The current source-only, personal-use prototype is not a redistribution audit.
4. Add sentence highlighting or shared audio ownership across Pi windows only if the playback trial shows a concrete need. Do not close #4 or claim dyslexia-specific efficacy from these engineering checks.
