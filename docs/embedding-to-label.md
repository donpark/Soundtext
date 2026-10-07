# Audio labeling with EmbeddingGemma 2

> **Status: superseded for sound events.** This documents the zero-shot
> embedding approach that the PoC originally used. It was replaced by a trained
> AudioSet classifier (AST) because cosine similarity over terse labels was not
> discriminative enough for transients — see
> [`architecture.md`](architecture.md#why-a-trained-classifier-not-embeddings).
> The label-taxonomy sections below are still current reference material.

## Approach

EmbeddingGemma 2 maps text, images, video and audio into one shared
768-dimensional space. Labeling is therefore a nearest-neighbour problem, not a
generative one: embed the audio, embed each candidate label, and rank the
labels by cosine similarity. There is no label head and no fixed class list —
the label set is chosen by the caller.

Consequences worth knowing before adopting it:

- Labels are plain text, so the set can change without retraining.
- Accuracy depends entirely on how separable the labels are in that space.
- Terse, near-synonymous labels (`Yip`, `Cough`, `Clatter`, `Boing`) cluster
  together and produce a nearly flat score distribution.
- Softmax temperature does not affect ranking. It is monotonic, so it only
  reshapes the displayed confidence; the argmax is unchanged.

## Requirements

| Input | Requirement |
|---|---|
| Audio | mono, 16 kHz |
| Text labels | task prefix (below); no prefix on images/audio/video |
| Precision | bfloat16 or float32 — **not** float16, which returns NaN |
| Encoders | vision and audio encoders load independently and can be omitted |

## Task prefixes

Text inputs are steered by a short instruction prefix. Audio, image and video
inputs take none.

| Use case | Prefix |
|---|---|
| Classification (symmetric) | `task: classification \| query: {content}` |
| Clustering | `task: clustering \| query: {content}` |
| Sentence similarity | `task: sentence similarity \| query: {content}` |
| Retrieval (asymmetric) | `task: search result \| query: {query}` / `title: {title} \| text: {content}` |

Classification is symmetric, so the same prefix is applied to everything being
compared. Label text is the `{content}`.

## Usage

Text embeddings, via SentenceTransformers:

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("google/embeddinggemma-2")

label_emb = model.encode(
    ["task: classification | query: Clapping", "task: classification | query: Bark"],
    normalize_embeddings=True,
)
```

Multimodal inputs are passed as a mapping; media positions are marked in the
text with placeholder tokens (`<|image|>`, `<|video|>`, `<|audio|>`) and filled
from the corresponding key in order. An audio embedding is obtained with the
audio key, then compared against the label embeddings by dot product (both sides
are normalized, so the dot product is the cosine similarity).

## Label taxonomies

Sources for a candidate label set, in rough order of coverage.

### AudioSet ontology — 632 classes

Google's standard hierarchy for everyday sound. Names are short and common
(`Laughter`, `Dog bark`, `Engine idling`, `Door slam`). Of the 632 entries, 474
are leaves and 158 have children.

- Ontology JSON: <https://github.com/audioset/ontology/blob/master/ontology.json>
- Structure: `name`, `child_of`, `child_ids`, `description`.
- Leaves only: filter entries with a non-empty `child_ids`.

Note that parents are semantic groupings, not sounds. In a flat comparison a
parent can outrank its own children, so either exclude parents or use the
two-stage search described below.

### ESC-50 — 50 classes

A curated, non-overlapping set of everyday sounds, in five groups of ten:
animals; natural soundscapes and water; human non-speech; domestic/interior;
exterior/urban.

- Metadata CSV: <https://github.com/karoldvl/ESC-50/blob/master/meta/esc50.csv>
- The 50 labels are the unique values of the `category` column; underscores are
  used in the CSV and should be replaced with spaces.

### BBC Sound Effects — 23 categories

A clip library rather than a taxonomy: ~33,000 recordings grouped under 23
top-level categories (Nature, Transport, Machines, Daily Life, Military,
Clocks, …). Its per-clip `tags` are free-text metadata — species names,
locations, technical descriptors — and are not usable as sound classes without
heavy curation.

- Category counts:
  `https://sound-effects-api.bbcrewind.co.uk/api/sfx/cached/categoryaggregations`

### Combined

AudioSet leaves (474) plus the non-overlapping ESC-50 and BBC categories gives
approximately 540 distinct classes. The three sources together amount to a few
hundred classes, not thousands; the large figures associated with them are clip
counts.

## Two-stage matching

To reduce parent/child competition, classify hierarchically:

1. Compare against a small set of broad parents (e.g. human, animal, natural,
   music, machine, vehicle).
2. Compare against the children of the winning parent only.

This keeps each comparison set small and separable, which matters more than the
total label count.

## Measured accuracy

Against known ESC-50 clips, zero-shot ranking with 539 labels put the correct
label at rank 5 for a clap (behind `Boing`) and never surfaced `Bark` for a dog
clip. Top scores were around 1%. Mean-centering the embeddings improved glass
detection substantially but did not fix the transient cases; window length
(1 s vs 2 s) made no difference. This is the reason the implementation moved to
a trained classifier.

## References

- Model card: <https://huggingface.co/google/embeddinggemma-2>
- ONNX build for the browser: <https://huggingface.co/onnx-community/embeddinggemma-2-ONNX>
- MediaPipe zero-shot classification guidance:
  <https://developers.googleblog.com/google-ai-edge-with-embeddinggemma-2/>
