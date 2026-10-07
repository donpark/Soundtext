// Sound-event classification with a trained AudioSet classifier (AST).
//
// This replaces the earlier zero-shot EmbeddingGemma approach: cosine similarity
// against 539 terse labels was not discriminative enough for transients
// (measured: a clap's correct label ranked 5th). AST is trained on AudioSet, so
// labels come straight from the model and the 485 MB EmbeddingGemma bundle can
// be dropped entirely.
import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;

const MODEL = "onnx-community/ast-finetuned-audioset-10-10-0.4593-ONNX";

export type SoundEvent = { label: string; score: number };
export type LoadProgress = { pct: number };

type Classifier = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<SoundEvent[]>;

let pipePromise: Promise<Classifier> | null = null;

function getPipeline(onProgress?: (p: LoadProgress) => void): Promise<Classifier> {
  if (!pipePromise) {
    pipePromise = (
      pipeline("audio-classification", MODEL, {
        device: "webgpu",
        dtype: "fp16",
        progress_callback: (e: { status: string; loaded?: number; total?: number }) => {
          if (e.status === "progress" && e.total) {
            onProgress?.({ pct: Math.round(((e.loaded ?? 0) / e.total) * 100) });
          }
        },
      }) as unknown as Promise<Classifier>
    ).catch((e) => {
      pipePromise = null; // let a retry re-attempt the load
      throw e;
    });
  }
  return pipePromise;
}

export async function loadSound(
  onProgress?: (p: LoadProgress) => void,
): Promise<void> {
  await getPipeline(onProgress);
}

// `pcm` must be mono at 16 kHz.
export async function classifySound(pcm: Float32Array): Promise<SoundEvent[]> {
  const classifier = await getPipeline();
  const out = await classifier(pcm);
  return [...out].sort((a, b) => b.score - a.score);
}
