# SoundText

Ambient-awareness PoC: a device listens to its surroundings and shows a
continuous, glanceable stream of what it hears — sound events and nearby speech
— as a single line.

Motivating use case: someone wearing earphones (optionally with Meta Ray-Ban
Display glasses) who cannot hear their surroundings, but wants to know when
someone speaks to them, what was said, and which sounds matter for safety.

```
soundtext/
  docs/     design notes (see docs/architecture.md)
  web/      the PoC webapp — Vite + React + TypeScript + Tailwind
  ios/      not yet; planned MVP
```

## What it does

Two independent in-browser pipelines feed one ticker. They are separate on
purpose: speech recognition must never delay sound detection.

| Pipeline | Model | Runtime |
|---|---|---|
| **Sound events** | AST — AudioSet classifier, 527 classes | transformers.js / ONNX on WebGPU |
| **Speech** | Whisper-base, gated by Silero VAD | transformers.js + `@ricky0123/vad-web` |

A sound renders as `[clap]`, speech as `“sorry”`, and the line marches
right→left. `tickerText(queue)` is the single-line form intended for a Meta
glasses layout (the glasses cannot animate, so they get whole snapshots).

Everything runs on-device; audio never leaves the machine. **WebGPU is
required** (Chrome/Edge desktop).

## Quick start

```bash
pnpm install
pnpm web dev        # http://localhost:5173
```

From the repo root, `pnpm web <script>` forwards to the `web` package:

```bash
pnpm web build          # typecheck + production build
pnpm web test           # unit checks (RMS, WAV)
pnpm web smoke          # headless end-to-end: dev server + Chrome + a real clap as the mic
pnpm web sound-check    # headless: label accuracy against known ESC-50 clips
pnpm web speech-check   # headless: Whisper transcribes a known clip
pnpm web speech-e2e     # headless: VAD → Whisper → ticker
```

The headless checks drive real Chrome at `http://localhost` — a secure origin,
which is what makes `navigator.gpu` available.

## Docs

- [`docs/architecture.md`](docs/architecture.md) — how the pipelines, gates, ticker and caching fit together
- [`web/README.md`](web/README.md) — the webapp in detail
- [`docs/embedding-to-label.md`](docs/embedding-to-label.md) — the original
  zero-shot EmbeddingGemma approach; superseded for sound events, kept for reference
- [`docs/ios-meta-glass.md`](docs/ios-meta-glass.md) — Meta Ray-Ban Display output

## Status

PoC. The webapp listens, classifies sound events, transcribes speech, and
streams both to the ticker; all of it is covered by headless checks.

Not built yet: the iOS/UIKit MVP, the Meta glasses output, speaker
diarization ("who spoke"), and any notion of speech being *directed at* the
wearer. See `docs/architecture.md` for the reasoning behind the current design.
