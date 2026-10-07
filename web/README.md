# SoundText

PoC: a single-page webapp that listens to the microphone and shows a stream of
what it hears — sound events and nearby speech — as one ticker.

- **Stack:** Vite + React + TypeScript + Tailwind CSS (v4), no backend
- **Sound events:** [AST](https://huggingface.co/onnx-community/ast-finetuned-audioset-10-10-0.4593-ONNX) — an AudioSet-trained classifier (527 classes) via transformers.js on WebGPU
- **Speech:** [Whisper](https://huggingface.co/onnx-community/whisper-base) (`whisper-base`, fp16) gated by [Silero VAD](https://github.com/ricky0123/vad) (`@ricky0123/vad-web`)

The two pipelines are independent: ASR must never delay sound detection, and
speech is never inferred from the sound classifier.

**Requires WebGPU** (Chrome/Edge desktop). The app shows an explicit error if
`navigator.gpu` is missing.

```bash
pnpm install
pnpm dev            # http://localhost:5173
pnpm build          # typecheck + production build
pnpm test           # unit checks (RMS, WAV)
pnpm smoke          # headless end-to-end: dev server + Chrome + a real clap as the mic
pnpm sound-check    # headless: label accuracy against known ESC-50 clips
pnpm speech-check   # headless: Whisper transcribes a known clip
pnpm speech-e2e     # headless: VAD → Whisper → ticker
```

From the repo root, prefix with `web`: `pnpm web dev`, `pnpm web smoke`, …

The headless checks drive real Chrome at `http://localhost` — a secure origin,
which is what makes `navigator.gpu` available (it is `undefined` on
`about:blank` and any plain-`http://` host). They use a persistent profile
(`web/.smoke-profile`) so models survive between runs.

## How it works

**Sound path** (`src/lib/sound.ts`)

1. Mic is captured at 16 kHz mono and cut into non-overlapping 2 s windows.
2. Near-silent windows are skipped. The classifier always returns a label —
   silence included — so an adaptive RMS gate (`SILENCE_RMS`, tracked noise
   floor) runs first; without it, silence emits confident nonsense.
3. AST classifies the window on WebGPU, returning AudioSet labels with scores.
4. A label reaches the ticker only if it clears `MIN_SOUND_SCORE` (0.2) and
   differs from the last one shown (`SOUND_COOLDOWN_MS` bounds the rate; the
   same label re-announces after `SOUND_RENOTIFY_MS`).

**Speech path** (`src/lib/speech.ts`)

Silero VAD gates Whisper, so ASR runs per utterance instead of continuously. It
loads in the background so its model download never delays the sound path.
VAD is only a gate — it says "speech present", not "someone is talking to you",
and it is not in the safety path. VAD assets come from CDNs (`VAD_ASSETS` /
`ORT_ASSETS`) because the package ships neither its worklet nor its Silero
weights in a bundler-usable location.

**Display** (`src/components/Ticker.tsx`)

One line, moving right→left: sounds as `[clap]`, speech as `“sorry”`. Tokens
queue behind whatever is still on screen, so a burst of detections streams in
one at a time rather than dumping. `tickerText(queue)` renders the same queue as
a single line for a Meta glasses layout (DAT has no partial updates, so the
glasses get whole snapshots re-sent on change, not a pixel scroll).

## Why not EmbeddingGemma zero-shot

The original approach embedded audio with EmbeddingGemma 2 and compared it by
cosine similarity against ~539 AudioSet/ESC-50 labels. Measured against known
clips, it was not discriminative enough for transients: a clap's correct label
ranked 5th behind `Boing`, and a dog clip never surfaced `Bark`. Score
distributions were nearly flat (top ≈ 1%). Mean-centering the embeddings helped
(applause/glass sharpened markedly) but did not fix it. A trained classifier is
the right tool, and it removed the 485 MB model entirely.

`docs/embedding-to-label.md` is kept for reference but no longer describes the
sound path.

## Deferred

- Self-host the VAD assets instead of the jsDelivr CDN defaults.
- Recording/saving clips; an explicit `unknown`/confidence policy.
- iOS/UIKit app (evaluate `soniqo/speech-swift` for VAD + ASR + diarization) and
  the Meta Ray-Ban Display output (`../docs/ios-meta-glass.md`).
