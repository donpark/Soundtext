# Architecture

## Shape

```
mic ──► 16 kHz mono, 2 s windows, AudioWorklet (web/src/worklets/pcm-worklet.js)
  │
  ├── sound path ──► RMS gate ──► AST (AudioSet, 527 classes) ──┐
  │                                                            │
  └── speech path ─► Silero VAD ──► Whisper-base ──────────────┤
                                                               ▼
                                                    TickerItem queue
                                                               │
                                        ┌──────────────────────┴──────────────────────┐
                                        ▼                                             ▼
                              browser: rAF marquee                    glasses: tickerText(queue)
                              (smooth, 70 px/s)                       (snapshot on change)
```

The two paths never share a model and never block each other. Speech's model
download happens in the background after the sound path is already live.

## Sound path — `web/src/lib/sound.ts`

1. **RMS gate.** A trained classifier always returns a label, silence included,
   so near-silent windows are dropped first. Threshold is
   `max(SILENCE_RMS, noiseFloor * SIGNAL_OVER_NOISE)`; the noise floor adapts
   downward while it is quiet so a noisy room doesn't spam the ticker.
2. **Classify.** AST (`onnx-community/ast-finetuned-audioset-10-10-0.4593-ONNX`)
   runs on WebGPU via transformers.js and returns AudioSet labels with scores.
3. **Noteworthiness.** A label is queued only if it clears `MIN_SOUND_SCORE`
   (0.2), differs from the last one shown, and respects `SOUND_COOLDOWN_MS`
   (2 s). The same label re-announces after `SOUND_RENOTIFY_MS` (12 s).

### Why a trained classifier, not embeddings

The first implementation embedded audio with EmbeddingGemma 2 and compared it by
cosine similarity against ~539 AudioSet/ESC-50 labels. Measured against known
clips it was not discriminative enough for transients:

| clip | EmbeddingGemma zero-shot | AST |
|---|---|---|
| clap | correct label ranked **5th** (behind `Boing`) | `Clapping` **65 %** @1 |
| glass | `Smash` 1.4 % | `Breaking` **89 %** @1 |
| dog | `Bark` never surfaced | `Bark` **22 %** @1 |

Score distributions were nearly flat (top ≈ 1 %). Mean-centering the embeddings
helped glass but not clap/dog; 1 s vs 2 s windows made no difference. Softmax
temperature cannot help either — it is monotonic, so it only reshapes displayed
confidence, never the argmax. A trained classifier is simply the right tool, and
it removed a 485 MB model from the download.

## Speech path — `web/src/lib/speech.ts`

Silero VAD gates Whisper-base, so ASR runs per utterance rather than
continuously. Each finished utterance is transcribed and queued as speech.

VAD is only a gate. It answers "is speech present", not "is someone talking to
you" — it is not in the sound/safety path, and it cannot tell speech directed at
the wearer from a TV or the next table. Distinguishing those needs loudness,
direction-of-arrival from a mic array, and keyword spotting, none of which is
built yet.

VAD assets come from CDNs (`VAD_ASSETS` / `ORT_ASSETS`) because
`@ricky0123/vad-web` ships neither its worklet nor its Silero weights in a
bundler-usable location. The ORT version must match the one vad-web resolves.

## Display — `web/src/components/Ticker.tsx`

One line, constant speed, tokens entering right and exiting left.
`TickerItem[]` is the source of truth; `tickerText(items, max)` renders the same
queue as a single line.

Two details worth preserving:

- **Placement happens in the rAF loop, not the ref callback.** React runs child
  refs before the parent's, so `viewport.clientWidth` is 0 at ref time; placing
  there collapsed the spacing and made everything look unpaced.
- **Queueing paces bursts.** A new token is positioned behind whatever is still
  on screen, so five simultaneous detections stream in one at a time rather than
  appearing at once.

A Meta Ray-Ban Display layout cannot animate: DAT has no partial updates —
`send(layout)` replaces the whole 600×600 view. So the glasses renderer
re-sends `tickerText(queue)` when the queue changes (throttled), rather than
streaming pixels.

## Caching — `web/src/lib/cleanup.ts`

- AST/Whisper weights live in transformers.js's own Cache Storage.
- `clearAllCaches()` backs the **Cleanup** button and deletes every entry this
  origin created. It does not touch the browser HTTP cache or the in-memory
  engines; a reload re-downloads.
- Download progress renders only when bytes are actually downloading — a cache
  hit goes straight through.

## Tests

| script | what it proves |
|---|---|
| `pnpm web test` | RMS and WAV encoding units |
| `pnpm web sound-check` | AST labels known ESC-50 clips correctly (top-2) |
| `pnpm web speech-check` | Whisper transcribes a known clip exactly |
| `pnpm web speech-e2e` | VAD → Whisper → ticker, with a real speech WAV as the mic |
| `pnpm web smoke` | full app boot; feeds a real clap and asserts `[Clapping]` reaches the ticker |

All headless checks use real Chrome at `http://localhost` (a secure origin) with
a persistent profile so models survive between runs. A synthetic tone is not
usable as a sound fixture: it classifies as low-confidence `Sound effect` and is
correctly gated out.
