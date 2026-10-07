# SoundText

![The SoundText demo page: the wordmark, two labelled lanes scrolling [clapping] and a transcript, and the live status row.](docs/cover.png)

SoundText is an ambient-awareness proof of concept. A device listens to its
surroundings. It shows what it hears on two moving lines: sound events on the
upper line, speech on the lower one.

Motivating use case: a person wears earphones, and optionally Meta Ray-Ban
Display glasses. The person cannot hear the surroundings, but wants to know
when someone speaks to them, what that person said, and which sounds matter for
safety.

Live demo: <https://donpark.github.io/Soundtext/>. Use Chrome or Edge on a
desktop.

```
soundtext/
  docs/     design notes (see docs/architecture.md)
  web/      the PoC webapp — Vite + React + TypeScript + Tailwind
  ios/      not built yet, planned MVP
```

## What it does

Two independent pipelines in the browser feed the two lanes. The upper lane
carries sound events. The lower lane carries speech. The pipelines stay
separate on purpose: speech recognition must never delay sound detection.

| Pipeline | Model | Runtime |
|---|---|---|
| **Sound events** | AST, an AudioSet classifier with 527 classes | transformers.js / ONNX on WebGPU |
| **Speech** | Whisper-base, gated by Silero VAD | transformers.js + `@ricky0123/vad-web` |

A sound event shows as `[clap]`, always in lower case. Speech shows as
`“sorry”`, and keeps the casing of the transcript. Both lanes move from right
to left. `tickerText(queue)` merges a lane into the single line
a Meta glasses layout needs. The glasses cannot animate, so they receive whole
snapshots.

Everything runs on the device. Audio never leaves the machine. **WebGPU is
required** (Chrome or Edge on a desktop).

The first run downloads about 350 MB of models. The download contains the
sound classifier (174 MB), the speech model (146 MB), and the speech runtime
(28 MB). The browser caches all of it, so later runs start immediately.

## Quick start

```bash
pnpm install
pnpm web dev        # http://localhost:5173
```

From the repo root, `pnpm web <script>` runs the script in the `web` package:

```bash
pnpm web build          # typecheck and production build
pnpm web test           # unit checks (RMS, WAV)
pnpm web smoke          # headless end-to-end: dev server, Chrome, and a real clap as the microphone
pnpm web sound-check    # headless: label accuracy against known ESC-50 clips
pnpm web speech-check   # headless: Whisper transcribes a known clip
pnpm web speech-e2e     # headless: VAD → Whisper → ticker
```

The headless checks drive real Chrome at `http://localhost`. That address is a
secure origin. `navigator.gpu` is available only on a secure origin.

A push to `main` deploys the webapp to GitHub Pages.

## Docs

- [`docs/architecture.md`](docs/architecture.md) — how the pipelines, gates, ticker and caching fit together
- [`web/README.md`](web/README.md) — the webapp in detail
- [`docs/embedding-to-label.md`](docs/embedding-to-label.md) — the original
  zero-shot EmbeddingGemma approach. AST replaces it for sound events, but the
  document stays for reference.
- [`docs/ios-meta-glass.md`](docs/ios-meta-glass.md) — Meta Ray-Ban Display output

## Status

Proof of concept. The webapp listens, classifies sound events, transcribes
speech, and streams both to the ticker. Headless checks cover all of it.

Not built yet:

- the iOS/UIKit MVP
- the Meta glasses output
- speaker diarization (which speaker said what)
- any idea of speech that is directed at the wearer

See `docs/architecture.md` for the reasoning behind the current design.
