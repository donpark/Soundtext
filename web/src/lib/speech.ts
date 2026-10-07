// Speech path: Silero VAD gates Whisper ASR. Deliberately separate from the
// always-on sound-event path in `classifier.ts` — safety events must not wait
// on (or be diluted by) speech recognition. VAD is used only as a cheap gate so
// Whisper runs on utterances instead of continuously.
import { MicVAD } from "@ricky0123/vad-web";
import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;

const ASR_MODEL = "onnx-community/whisper-base";

// vad-web's default asset path resolves relative to the bundle, which 404s
// under Vite. It also ships no runtime of its own: the worklet, the Silero
// weights and the onnxruntime-web WASM all come from CDNs. ORT version must
// match vad-web's resolved onnxruntime-web (see its package.json, ^1.17.0).
const VAD_ASSETS = "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.31/dist/";
const ORT_ASSETS = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";

export type SpeechEvent = { text: string; at: number };
export type SpeechStatus = "idle" | "loading" | "listening" | "error";

type Asr = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<{ text?: string }>;

let asrPromise: Promise<Asr> | null = null;
let vad: MicVAD | null = null;

function getAsr(): Promise<Asr> {
  if (!asrPromise) {
    asrPromise = (
      pipeline("automatic-speech-recognition", ASR_MODEL, {
        device: "webgpu",
        dtype: "fp16",
      }) as unknown as Promise<Asr>
    ).catch((e) => {
      asrPromise = null; // let a retry re-attempt the load
      throw e;
    });
  }
  return asrPromise;
}

// Exported so it can be exercised directly (see scripts/speech-check.mjs).
export async function transcribe(audio: Float32Array): Promise<string> {
  const asr = await getAsr();
  const out = await asr(audio, {
    language: "en",
    task: "transcribe",
    // Whisper hallucinates fluent text on non-speech; VAD already gated this,
    // and these options further reduce confident nonsense on marginal audio.
    no_speech_threshold: 0.6,
    condition_on_prev_tokens: false,
    temperature: 0,
  });
  return (out?.text ?? "").trim();
}

export async function startSpeech(
  onEvent: (e: SpeechEvent) => void,
  onStatus: (s: SpeechStatus) => void,
  onActivity?: (speaking: boolean) => void,
): Promise<void> {
  onStatus("loading");
  try {
    await getAsr();
    vad = await MicVAD.new({
      model: "v5",
      baseAssetPath: VAD_ASSETS,
      onnxWASMBasePath: ORT_ASSETS,
      // Defaults from the wrapper; redemptionMs gives a pause before end.
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.35,
      minSpeechMs: 300,
      preSpeechPadMs: 200,
      redemptionMs: 800,
      onSpeechEnd: (audio) => {
        console.info(
          `[soundtext] speech end: ${(audio.length / 16000).toFixed(1)}s`,
        );
        void transcribe(audio)
          .then((text) => {
            console.info(`[soundtext] transcript: "${text}"`);
            if (text) onEvent({ text, at: Date.now() });
          })
          .finally(() => onActivity?.(false))
          .catch((e) => console.error("[soundtext] transcribe failed", e));
      },
      onSpeechStart: () => {
        console.info("[soundtext] speech start");
        onActivity?.(true);
      },
      onVADMisfire: () => onActivity?.(false),
    });
    await vad.start();
    onStatus("listening");
  } catch (e) {
    console.error("[soundtext] speech start failed", e);
    onStatus("error");
    throw e;
  }
}

export async function stopSpeech(
  onStatus?: (s: SpeechStatus) => void,
): Promise<void> {
  await vad?.destroy();
  vad = null;
  onStatus?.("idle");
}
