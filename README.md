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

The adapted Caveman writing policy in [`SKILL.md`](SKILL.md), enabled automatically on every Pi start. Version `0.2.0` replaces the unmodified upstream skill with this single local policy; there are no intensity levels. The extension injects it before each agent run. No hard word cap or automatic rewriting.

The priority is fewer words without losing requested coverage, meaning, or warnings. The policy retains Caveman's STE-inspired rules and adds targeted guidance for context, terminology, structure, and uncertainty. [Writing research](docs/research/writing.md) records the evidence and evaluation plan for issue #2. Reader benefits and model adherence still need testing; this is not a universally proven prompt.

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

For the `0.2.0` trial, start a fresh Pi session after updating so previous ultra instructions do not remain in the conversation. Run `/dyslexia caveman status`; the footer should show `caveman: on`. Use `/dyslexia caveman off` to compare normal prose. Updating the package does not update an already loaded extension until restart or `/reload`.

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

## Caveman controls

```text
/dyslexia caveman off      Use normal prose for this session
/dyslexia caveman on       Enable the adapted policy again
/dyslexia caveman status   Show current state
```

`/dyslexia` also shows the current state. A static footer indicator shows `caveman: on` or `caveman: off`.

Caveman always starts **on**. Turning it off is temporary: restarting Pi, `/new`, `/resume`, `/fork`, or `/reload` enables the adapted policy again. No preference file is written. Commands affect the next agent run, not a response already streaming. Saying "normal mode" does not change the extension's setting; use the off command.

The extension appends instructions; it does not rewrite stored messages or code. Model adherence is not guaranteed. The adapted policy preserves meaningful uncertainty and safety warnings, discourages invented abbreviations and causal arrows, and allows compression only when relationships remain clear.

## Check

With Node.js 22.6 or newer:

```sh
npm test
```

No build step is required. Pi loads the TypeScript entry point directly.

## Policy source and license

[`SKILL.md`](SKILL.md) is adapted from [JuliusBrussee/caveman's skill](https://github.com/JuliusBrussee/caveman/blob/5184b3d11ac6a1acb7d44b9bfaa31698157cff97/skills/caveman/SKILL.md). It retains the core Rules and Auto-Clarity sections, integrates useful ultra rules, removes intensity switching, and adds the reviewed local changes. The original source revision is recorded in the file; this is a local adaptation, not an unchanged upstream copy.

The upstream copyright and MIT permission notice are preserved in [`LICENSE`](LICENSE), scoped to the adapted skill. No upstream engine or proxy code is included. The old `vendor/` directory is removed.

The package includes `index.ts`, `SKILL.md`, and `LICENSE`. The skill is not registered separately with Pi (`pi.skills` is empty); only the extension injects it and controls activation.

## How we work

**Issue → research → design decision → implementation → checks.**

- [Issues](https://github.com/marcoazzurrini/pi-dyslexia/issues) track questions, deliverables, and completion criteria. Split implementation tasks out when designs are concrete.
- Research notes go in `docs/research/` as each investigation starts. Record primary sources, findings, limitations, and resulting decisions. Distinguish experimental evidence from style advice and personal preferences.
- Evaluate comprehension, task success, and comfort—not just word count or reading speed.

Keep original messages and executable text intact. Display and speech preferences should be optional and reversible.
