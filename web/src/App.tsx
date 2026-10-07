import { useCallback, useRef, useState } from "react";
import { SoundCapture, rms } from "./lib/audio";
import { classifySound, loadSound, type LoadProgress } from "./lib/sound";
import { clearAllCaches } from "./lib/cleanup";
import { startSpeech, stopSpeech, type SpeechStatus } from "./lib/speech";
import { Ticker, type TickerItem } from "./components/Ticker";

type Status = "idle" | "loading" | "listening" | "error";

// AST is a trained classifier, so its scores are meaningful — require real
// confidence before a label reaches the ticker.
const MIN_SOUND_SCORE = 0.2;
const SOUND_COOLDOWN_MS = 2000;
// Re-announce the same label if it's been quiet this long (a repeat clap after
// a lull is a new event).
const SOUND_RENOTIFY_MS = 12000;
// Skip near-silent windows before classifying. The classifier always returns a
// label, silence included, so without this it emits confident nonsense. The
// floor is adaptive: it tracks ambient level so a noisy room doesn't spam.
const SILENCE_RMS = 0.005;
const SIGNAL_OVER_NOISE = 3;
const MAX_TICKER_ITEMS = 40;

export default function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>("idle");
  const [items, setItems] = useState<TickerItem[]>([]);
  const [lastLabel, setLastLabel] = useState("");

  const capture = useRef(new SoundCapture());
  const busy = useRef(false);
  const nextId = useRef(0);
  const lastSound = useRef({ label: "", at: 0 });
  const noiseFloor = useRef(0.004);

  const enqueue = useCallback((kind: TickerItem["kind"], text: string) => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, kind, text }].slice(-MAX_TICKER_ITEMS));
  }, []);

  const removeItem = useCallback((id: number) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  async function ensureModel(): Promise<boolean> {
    setError("");
    setProgress(null);
    setStatus("loading");
    try {
      await loadSound(setProgress);
      setModelReady(true);
      console.info("[soundtext] sound model ready");
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[soundtext] sound model failed", e);
      setError(msg);
      setStatus("error");
      return false;
    }
  }

  async function start() {
    if (!(await ensureModel())) return;
    try {
      await capture.current.start(onWindow);
      setStatus("listening");
      // Speech is a second pipeline running in parallel. Its model downloads in
      // the background so it never delays the sound-event path.
      void startSpeech(
        (e) => enqueue("speech", e.text),
        setSpeechStatus,
      ).catch((err) =>
        console.error("[soundtext] speech pipeline failed", err),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[soundtext] microphone failed", e);
      setError(msg);
      setStatus("error");
    }
  }

  async function stop() {
    await capture.current.stop();
    await stopSpeech(setSpeechStatus);
    setStatus("idle");
  }

  async function cleanup() {
    const removed = await clearAllCaches();
    console.info(`[soundtext] cleanup removed=[${removed.join(", ")}]`);
    setNotice(
      removed.length
        ? `cleared ${removed.length} cache(s) — next load re-downloads`
        : "nothing cached",
    );
  }

  function onWindow(pcm: Float32Array) {
    if (busy.current) return; // drop windows while the model is still working
    const level = rms(pcm);
    if (level < Math.max(SILENCE_RMS, noiseFloor.current * SIGNAL_OVER_NOISE)) {
      // Track ambient downward while it's quiet; leave it alone during signal.
      noiseFloor.current = noiseFloor.current * 0.9 + level * 0.1;
      return;
    }
    busy.current = true;
    classifySound(pcm)
      .then((preds) => {
        const top = preds[0];
        if (!top) return;
        setLastLabel(top.label);
        if (top.score < MIN_SOUND_SCORE) return;
        const now = Date.now();
        const changed = top.label !== lastSound.current.label;
        const stale = now - lastSound.current.at >= SOUND_RENOTIFY_MS;
        if (
          (changed || stale) &&
          now - lastSound.current.at >= SOUND_COOLDOWN_MS
        ) {
          lastSound.current = { label: top.label, at: now };
          enqueue("sound", top.label);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        busy.current = false;
      });
  }

  const active = status === "listening";

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center px-6 py-12">
      <h1 className="text-sm uppercase tracking-[0.3em] text-neutral-500">
        SoundText
      </h1>
      <p className="mt-1 text-xs text-neutral-600">
        proof of concept · on-device sound + speech awareness
      </p>

      <div className="mt-12 w-full max-w-3xl">
        <Ticker items={items} onExit={removeItem} />
      </div>

      <div className="mt-6 flex items-center gap-4 text-xs text-neutral-600">
        <span data-sound-label={lastLabel} className="sr-only" />
        <span>
          speech:{" "}
          <span
            data-speech-status={speechStatus}
            className={
              speechStatus === "listening"
                ? "text-neutral-400"
                : speechStatus === "error"
                  ? "text-red-400"
                  : ""
            }
          >
            {SPEECH_LABEL[speechStatus]}
          </span>
        </span>
      </div>

      <ModelPanel
        status={status}
        progress={progress}
        ready={modelReady}
        error={error}
        onRetry={start}
      />

      <button
        onClick={active ? stop : start}
        disabled={status === "loading"}
        className={`mt-8 rounded-full px-8 py-3 font-medium transition disabled:opacity-50 ${
          active
            ? "bg-red-500/90 hover:bg-red-500 text-white"
            : "bg-emerald-500 hover:bg-emerald-400 text-neutral-950"
        }`}
      >
        {status === "loading"
          ? "loading model…"
          : active
            ? "Stop"
            : "Start listening"}
      </button>

      <div className="mt-6 flex items-center gap-3 text-xs">
        <button
          onClick={cleanup}
          className="rounded-md border border-neutral-700 px-3 py-1 text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200"
        >
          Cleanup
        </button>
        {notice && <span className="text-neutral-500">{notice}</span>}
      </div>
    </main>
  );
}

const SPEECH_LABEL: Record<SpeechStatus, string> = {
  idle: "—",
  loading: "loading model…",
  listening: "listening",
  error: "unavailable",
};

function ModelPanel({
  status,
  progress,
  ready,
  error,
  onRetry,
}: {
  status: Status;
  progress: LoadProgress | null;
  ready: boolean;
  error: string;
  onRetry: () => void;
}) {
  if (status === "loading") {
    // Only show a download bar when something is actually downloading; a cache
    // hit jumps straight through.
    if (!progress) {
      return <div className="mt-6 text-xs text-neutral-600">loading model…</div>;
    }
    return (
      <div className="mt-8 w-full max-w-xl rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
        <div className="flex justify-between text-xs text-neutral-400">
          <span>Downloading model…</span>
          <span className="tabular-nums">{progress.pct}%</span>
        </div>
        <div className="mt-2 h-2 rounded bg-neutral-800 overflow-hidden">
          <div
            className="h-full bg-sky-500 transition-[width] duration-300"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mt-8 w-full max-w-xl rounded-lg border border-red-900/60 bg-red-950/30 p-4">
        <div className="text-xs text-red-300 font-medium">
          {ready ? "Microphone failed" : "Model failed to load"}
        </div>
        <p className="mt-1 text-xs text-red-400/80 break-words">{error}</p>
        {!ready && (
          <button
            onClick={onRetry}
            className="mt-3 rounded-md bg-red-500/90 hover:bg-red-500 px-4 py-1.5 text-xs font-medium text-white"
          >
            Retry download
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-6 text-xs text-neutral-600">
      {ready ? "sound model ready" : "sound model not loaded"}
    </div>
  );
}
