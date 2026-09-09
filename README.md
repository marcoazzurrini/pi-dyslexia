# pi-dyslexia

This extension is intended for personal use first, therefore, it can afford to be opinionated.

Make the [Pi coding agent](https://pi.dev) easier to read and listen to, especially for people with dyslexia.

**Work only. No reading-training mode.** Reduce reading effort without losing meaning, technical accuracy, or important warnings.

## Five layers

1. **[Response length](https://github.com/marcoazzurrini/pi-dyslexia/issues/1)** — Say less before doing anything else. Keep essential information; make extra detail available on request.
2. **[Writing principles](https://github.com/marcoazzurrini/pi-dyslexia/issues/2)** — Research clear writing and communication, broadly and for dyslexic readers. Concise should not mean cryptic.
3. **[Rendering](https://github.com/marcoazzurrini/pi-dyslexia/issues/3)** — Research typography, spacing, layout, and contrast. Separate Pi controls from terminal settings.
4. **[Text-to-speech](https://github.com/marcoazzurrini/pi-dyslexia/issues/4)** — Evaluate local speech engines and design comfortable, user-controlled playback.
5. **[Fading text](https://github.com/marcoazzurrini/pi-dyslexia/issues/5)** — Explore an optional work-time reading aid. Preserve rereading and access to the original text; no exercises or forced acceleration.

## Current focus

The project's writing policy in [`extensions/SKILL.md`](extensions/SKILL.md), enabled automatically on every Pi start. Version `0.2.0` replaces the unmodified upstream skill with this single local policy; there are no intensity levels. The extension injects it before each agent run. No hard word cap or automatic rewriting.

The policy prioritizes total response length: target under 120 words of chat prose per turn, including research summaries. This is a soft target, not a quota or enforced limit. Explicitly requested detail and essential completeness, clarity, or safety can require more; code and requested documents remain intact. Summaries retain main conclusions, decision-changing evidence and citations, conditions, uncertainty, and warnings. The policy retains Caveman's STE-inspired rules and adds targeted guidance for context, terminology, structure, and uncertainty. [Writing research](docs/research/writing.md) records the evidence and evaluation plan for issue #2. Reader benefits and model adherence still need testing; this is not a universally proven prompt.

## Install

```sh
pi install git:github.com/marcoazzurrini/pi-dyslexia
```

Install without an `@version` or commit suffix so Pi can detect and apply updates. The Git installation is a separate clone; editing this development checkout does not change the installed extension.

If replacing `pi-caveman`, remove it before restarting Pi so two extensions do not inject competing rules:

```sh
pi remove npm:pi-caveman
```

Start a fresh Pi session after switching; existing conversations can contain old Caveman instructions. This package is private to prevent accidental npm publication; Git installation still works.

## Updates

Pi already checks installed, unpinned Git packages for updates during interactive startup. When this repository's tracked branch (`main` for a normal installation) has a different commit, Pi shows **Package Updates Available** and suggests:

```sh
pi update --extensions
```

Run that command in your terminal, then restart Pi or run `/reload` in an existing session. It updates all eligible installed packages. To update only this one:

```sh
pi update git:github.com/marcoazzurrini/pi-dyslexia
```

Start a fresh Pi session after updating so previous style instructions do not remain in the conversation. Run `/dyslexia status`; the footer should show `dyslexia: on`. Use `/dyslexia off` to compare normal prose. Updating the package does not update an already loaded extension until restart or `/reload`.

This is a startup check, not a live GitHub push notification. It needs network access; `PI_OFFLINE` disables it. Pinned Git installs and local-path installs are excluded from update notifications. Do not edit the installed clone: Pi resets and cleans it during updates; make changes in this development repository instead.

For Git packages, **commits trigger notifications, not version numbers or release tags**. Every push to `main` can become an update, even without a version bump. No custom notifier, GitHub webhook, or npm publication is needed.

## Versioning and releases

`package.json` records the current version. Use patch versions for fixes, minor versions for features, and major versions for breaking changes. Keep unfinished work off `main`.

For subsequent releases, start from a clean, committed `main` checkout:

```sh
npm version patch -m "chore: release %s"
git push origin main --follow-tags
```

Use `minor` or `major` instead of `patch` when appropriate. `npm version` runs our tests through `preversion`, updates the version, and creates a commit and version tag. It does not publish to npm. Tags identify releases; unpinned Pi installs still follow `main`, not the latest tag.

The adapted policy is maintained here. Package updates deliver reviewed local changes; there is no automatic synchronization with upstream Caveman.

## Writing-policy controls

```text
/dyslexia off      Use normal prose for this session
/dyslexia on       Enable the writing policy again
/dyslexia status   Show current state
```

`/dyslexia` also shows the current state. A static footer indicator shows `dyslexia: on` or `dyslexia: off`.

Version `0.3.0` replaces version `0.2.0`'s `/dyslexia caveman ...` commands with the commands above. The old syntax shows the new usage without changing state. Installed `0.2.0` copies keep the old commands until updated and reloaded.

The writing policy always starts **on**. Turning it off is temporary: restarting Pi, `/new`, `/resume`, `/fork`, or `/reload` enables the adapted policy again. No preference file is written. Commands affect the next agent run, not a response already streaming. Saying "normal mode" does not change the extension's setting; use the off command.

The extension appends instructions; it does not rewrite stored messages or code. Model adherence is not guaranteed. The adapted policy preserves meaningful uncertainty and safety warnings, discourages invented abbreviations and causal arrows, and allows compression only when relationships remain clear.

## Local speech (v0.4.0 preview)

Version `0.4.0` adds local narration alongside the writing policy. It requires **Apple Silicon macOS, Pi 0.85.1 or newer, and English text**. Kokoro + MLX-Audio is the trial engine; [local measurements and remaining evaluation](docs/research/speech.md) are recorded separately. Listening comfort and technical pronunciation still need your assessment.

After installing or updating this package, start Pi normally. If read-aloud is not ready, Pi offers **Set up read-aloud** or **Not now**. Text responses work without speech setup. Choosing **Not now** (or dismissing the prompt) is remembered; you will not get an error after each answer.

To start setup later, or repair an incomplete installation, type this **inside Pi**, from any project:

```text
/speech setup
```

Setup explains the downloads and asks for permission before running anything. It installs [uv](https://docs.astral.sh/uv/) from its official installer if needed, prepares Python 3.12, installs speech dependencies and the English dictionary, and downloads the pinned Kokoro model. It requires internet access and disk space and may take several minutes. No administrator access or shell profile changes are required. Pi shows setup status and a retry command if installation fails. Exiting or reloading Pi cancels its running installer.

The runtime lives in `~/.cache/pi-dyslexia/venv`; a bootstrapped uv lives in `~/.cache/pi-dyslexia/bin`. Model files use Hugging Face's cache. Startup checks installed dependencies and model files offline, without loading the voice model or playing audio. Nothing downloads without setup consent. Setup itself does not play audio or read previous answers; it preserves any saved automatic-playback preference. Developers can also run `npm run setup:speech` from this checkout.

The installed package loads both the writing and speech extensions automatically. Fullscreen mode enables clickable controls; ordinary `pi` still supports shortcuts and commands. Restart Pi after updating. For development against an older installed package, use `npm install --legacy-peer-deps` and `pi -e ./extensions/speech/index.ts` from this repository. Do not add that entry point when the installed package already includes speech, or it will load twice.

```text
/speech setup         Install or repair read-aloud; explain downloads and ask permission
/speech auto on       Narrate future completed answers automatically; save preference
/speech              Play the selected/latest answer, or pause/resume active speech
/speech replay       Restart the selected answer from the beginning
/speech latest       Read the newest completed answer
/speech previous     Return to the previous speech chunk, usually a sentence
/speech stop         Stop playback and cancel pending synthesis immediately
/speech answers      Choose an earlier answer from this session branch
/speech speed 1.25   Set synthesis speed (0.5–2); upcoming speech uses the new setting
/speech voice        Choose an English voice preset
/speech preview      Hear a fixed voice sample; /speech latest returns to your answer
/speech include all  Include code blocks and URL destinations; replay to apply
/speech include prose  Announce skipped code blocks/URLs instead of reading them
/speech auto off      Disable automatic playback; manual controls still work
/speech off           Stop, unload the model, and disable automatic playback
/speech help          List controls
```

**Shortcuts:** `Ctrl+Alt+S` plays/pauses, `Ctrl+Alt+R` replays, and `Ctrl+Alt+X` stops. Some terminals reserve these keys; slash commands remain available. Clickable controls work only in Pi fullscreen mode and do not replace the editor or footer.

Automatic playback defaults to **on**, but remains inactive until the speech readiness check passes. A saved `/speech auto off` preference is still respected. Invalid or unreadable settings fall back to manual playback. A playback failure pauses automatic narration for the session instead of repeating the error after every answer; use `/speech auto on` to retry automatically or `/speech setup` to repair the installation. Preferences are stored in `~/.pi/agent/pi-dyslexia/speech.json`, independently of the writing policy. `/dyslexia off` does not stop speech. Loading a session never speaks old messages automatically. Narration starts only after Pi settles, not between tool calls. A new submitted prompt stops speech; typing alone does not. A paused or currently playing answer is not replaced by a newer answer; the widget offers `/speech latest` instead. There is no automatic backlog.

The first-run setup choice is remembered in `~/.pi/agent/pi-dyslexia/speech-setup-prompted`, separately from playback preferences. The settings and setup-choice paths use Pi's `getAgentDir()`, so `PI_CODING_AGENT_DIR` overrides the `~/.pi/agent` base directory. If the new file is missing, speech reads the old `~/.config/pi-dyslexia/speech.json` to preserve existing preferences. The next preference change saves to the new path; the old file remains untouched. `/speech status` shows the save path.

Speech reads a separate Markdown rendering, never an AI summary. The original message remains intact. Code blocks and URL destinations are skipped with spoken announcements by default. Inline identifiers are retained, tables are read row by row, and deleted text is identified as deleted. Speech is not a reliable way to copy code; use the original text for exact syntax. No word/sentence highlighting is implemented yet.

When automatic speech is enabled and installed, synthesis and the audio device warm in the background while the agent responds. One first chunk is prepared silently from streaming text; playback still waits for `agent_settled` and validates the final text, voice, speed, and content mode. A short response can finish before preparation, so cold starts can still take several seconds. See the [latency measurements](docs/research/speech-latency.md#implementation-follow-up).

Generation uses an owned Python subprocess. A separate sounddevice/PortAudio process keeps one output stream open across chunks and stops, so pause and stop do not wait for inference or reopen the device. Pause holds the sample position; small device buffers can still take a moment to drain. The widget reports playing only after the first output buffer. Only exact initial silence is trimmed, retaining a 20 ms safety margin; quiet speech and internal pauses remain intact. One upcoming chunk is generated ahead. Long sentences are split at 500 characters, so some boundaries may sound abrupt.

`/speech stop` also suppresses narration of the currently running answer; the next agent run can narrate normally. `/speech auto off` cancels silent preparation but does not interrupt an already playing answer. `/speech off` closes the model and output stream. Cancelling active synthesis still kills that worker because MLX has no per-request interrupt; the next automatic run warms its replacement. The open stream retains its selected output device; after changing devices, use `/speech off` followed by `/speech auto on` if needed to reopen the default output.

No cloud fallback, microphone, transcript logging, or HTTP server is used. All five presets were tested with OS networking denied. Temporary WAV files are private, bounded to a 32 MiB cache per session, and deleted on eviction or normal shutdown/reload/session replacement. An OS crash or `SIGKILL` can leave temporary files named `pi-dyslexia-speech-*` in the system temporary directory. Model downloads remain cached. Headless, JSON, print, and RPC runs never play speech. Multiple independent Pi windows have independent players; stop one before listening in another.

## Project layout

```text
extensions/
├── index.ts       # Writing extension
├── SKILL.md       # Private writing policy, loaded by index.ts
└── speech/        # Speech extension, worker, and setup files
test/
docs/
package.json
LICENSE
```

`package.json` explicitly registers `extensions/index.ts` and `extensions/speech/index.ts`. The policy is not discovered as a separate skill.

## Development checks and Git hooks

Use Node.js 24 for development tooling. Install the pinned tools and Git hooks:

```sh
npm ci
npm run hooks:install
```

The pre-commit hook runs Oxfmt on staged source and configuration files, stages the formatted results with Lefthook's `stage_fixed`, then runs Oxlint on staged JavaScript and TypeScript and a whole-project TypeScript check. The named jobs run sequentially and stop at the first failure. Lefthook preserves unstaged edits in partially staged files; if they cannot be restored safely, the commit fails. Review the diff before retrying a failed commit. Lint errors and warnings block the commit; lint fixes are never applied silently by the hook.

Typechecking runs when TypeScript, `tsconfig.json`, or dependency manifests are staged. It checks all extension TypeScript and the Oxc configuration files, not only the staged files. `tsconfig.json` enables strict checking without emitting JavaScript; dependency declaration files are skipped. JavaScript tests, research, and non-TypeScript assets are not typechecked. The compiler reads the working tree, subject to Lefthook's handling of partially staged files; it is not an isolated check of the Git index.

The pre-push hook runs `npm test`.

Oxlint extends Ultracite's core and bundled anti-slop presets without local rule relaxations. Oxfmt uses Ultracite's formatting preset. Documentation, the writing policy, Python, shell scripts, and text assets are outside this lint/format workflow. The generated npm lockfile is also excluded from formatting.

```sh
npm run format         # Explicitly format eligible project files
npm run format:check   # Check formatting without rewriting
npm run lint           # Check all eligible source files, including tests
npm run lint:fix       # Explicitly apply available safe lint fixes
npm run typecheck      # Strict TypeScript check, without emitting files
npm run check          # Formatting, lint, types, and unit tests
```

Tooling is a development dependency only; Pi installations without development dependencies do not need Lefthook or run a project `prepare` script.

## Check

With Node.js 22.6 or newer:

```sh
npm test
```

No build step is required. Pi loads the TypeScript entry points directly. Default tests fake synthesis and playback; they require no model download. On the setup Mac, run the opt-in worker/player checks (only silence is played):

```sh
npm run test:speech-local
```

## Policy source and license

[`extensions/SKILL.md`](extensions/SKILL.md) is adapted from [JuliusBrussee/caveman's skill](https://github.com/JuliusBrussee/caveman/blob/5184b3d11ac6a1acb7d44b9bfaa31698157cff97/skills/caveman/SKILL.md). It retains the core Rules and Auto-Clarity sections, integrates useful ultra rules, removes intensity switching, and adds the reviewed local changes. The original source revision is recorded in the file; this is a local adaptation, not an unchanged upstream copy.

The upstream copyright and MIT permission notice are preserved in [`LICENSE`](LICENSE), scoped to the adapted skill. No upstream engine or proxy code is included. The old `vendor/` directory is removed.

The package includes `extensions/index.ts`, `extensions/speech/` source and setup files, `extensions/SKILL.md`, and root `LICENSE`. The skill is not registered separately with Pi (`pi.skills` is empty); only the writing extension injects it and controls activation. Speech has a separate entry point and does not change the writing prompt. Model weights and the Python environment are not bundled. The speech runtime includes GPL-covered pronunciation dependencies; see the license notes in [speech research](docs/research/speech.md) before redistributing a bundled runtime.

## How we work

**Issue → research → design decision → implementation → checks.**

- [Issues](https://github.com/marcoazzurrini/pi-dyslexia/issues) track questions, deliverables, and completion criteria. Split implementation tasks out when designs are concrete.
- Research notes go in `docs/research/` as each investigation starts. Record primary sources, findings, limitations, and resulting decisions. Distinguish experimental evidence from style advice and personal preferences.
- Evaluate comprehension, task success, and comfort—not just word count or reading speed.

Keep original messages and executable text intact. Display and speech preferences should be optional and reversible.
