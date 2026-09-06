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

Optional upstream Caveman ultra, enabled automatically on every Pi start. The extension injects the bundled skill before each agent run. No word cap or automatic rewriting yet.

## Install

Once these package files are pushed to GitHub:

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

This is a startup check, not a live GitHub push notification. It needs network access; `PI_OFFLINE` disables it. Pinned Git installs and local-path installs are excluded from update notifications. Do not edit the installed clone: Pi resets and cleans it during updates; make changes in this development repository instead.

For Git packages, **commits trigger notifications, not version numbers or release tags**. Every push to `main` can become an update, even without a version bump. No custom notifier, GitHub webhook, or npm publication is needed.

## Versioning and releases

`package.json` records the version, starting at `0.1.0`. Use patch versions for fixes, minor versions for features, and major versions for breaking changes. Keep unfinished work off `main`.

After the initial package is tested and committed, mark its first release:

```sh
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin main --follow-tags
```

For subsequent releases, start from a clean, committed `main` checkout:

```sh
npm version patch -m "chore: release %s"
git push origin main --follow-tags
```

Use `minor` or `major` instead of `patch` when appropriate. `npm version` runs our tests through `preversion`, updates the version, and creates a commit and version tag. It does not publish to npm. Tags identify releases; unpinned Pi installs still follow `main`, not the latest tag.

This package-update flow is separate from checking JuliusBrussee's upstream Caveman skill for changes; that automation is not implemented yet.

## Caveman controls

```text
/dyslexia caveman off      Use normal prose for this session
/dyslexia caveman on       Enable upstream ultra again
/dyslexia caveman status   Show current state
```

`/dyslexia` also shows the current state. A static footer indicator shows `caveman: ultra` or `caveman: off`.

Caveman always starts **on**. Turning it off is temporary: restarting Pi, `/new`, `/resume`, `/fork`, or `/reload` enables ultra again. No preference file is written. Commands affect the next agent run, not a response already streaming. Saying "normal mode" does not change the extension's setting; use the off command.

The extension appends instructions; it does not rewrite stored messages or code. Model adherence is not guaranteed. Upstream ultra differs from the old extension's ultra: it discourages invented abbreviations and causal arrows. Meaningful uncertainty and safety warnings must be preserved.

## Check

With Node.js 22.6 or newer:

```sh
npm test
```

No build step is required. Pi loads the TypeScript entry point directly.

## Bundled Caveman

`vendor/caveman/SKILL.md` is copied unchanged from [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) at commit `5184b3d11ac6a1acb7d44b9bfaa31698157cff97`. Source paths and revision are recorded in `vendor/caveman/upstream.json`; upstream license and licensing scope are retained alongside the skill.

Only the MIT skill and its licensing documents are included, not the upstream engine or proxy. The skill is not registered separately with Pi; the extension controls activation. Automatic upstream update checks are not implemented yet.

## How we work

**Issue → research → design decision → implementation → checks.**

- [Issues](https://github.com/marcoazzurrini/pi-dyslexia/issues) track questions, deliverables, and completion criteria. Split implementation tasks out when designs are concrete.
- Research notes go in `docs/research/` as each investigation starts. Record primary sources, findings, limitations, and resulting decisions. Distinguish experimental evidence from style advice and personal preferences.
- Evaluate comprehension, task success, and comfort—not just word count or reading speed.

Keep original messages and executable text intact. Display and speech preferences should be optional and reversible.
