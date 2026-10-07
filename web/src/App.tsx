import { useCallback, useRef, useState, type ReactNode } from "react";
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
const SOURCE_URL = "https://github.com/donpark/Soundtext";

export default function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<LoadProgress | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>("idle");
  const [items, setItems] = useState<TickerItem[]>([]);
  const [lastLabel, setLastLabel] = useState("");
  // Level of the last window that was classified, and the gate it had to clear.
  // Shown so "why did nothing appear?" has an answer on screen.
  const [meter, setMeter] = useState({ peak: 0, gate: SILENCE_RMS });

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
        ? `cleared ${removed.length} cache(s) — the next start downloads again`
        : "nothing cached",
    );
  }

  function onWindow(pcm: Float32Array) {
    const level = rms(pcm);
    const gate = Math.max(SILENCE_RMS, noiseFloor.current * SIGNAL_OVER_NOISE);
    // Peak-hold so the meter doesn't flicker on every 2s window.
    setMeter((prev) => ({ peak: Math.max(level, prev.peak * 0.75), gate }));

    if (busy.current) return; // drop windows while the model is still working
    if (level < gate) {
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
    <main className="min-h-screen px-5 py-10 sm:px-8 sm:py-16">
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
          <div>
            <h1 className="wordmark text-2xl sm:text-[28px]">SOUNDTEXT</h1>
            <p className="mt-2 max-w-md text-sm text-ink-2">
              What is happening around you, written on one line.
            </p>
          </div>
          <p className="label">on-device · nothing recorded</p>
        </header>

        <section className="mt-10" aria-label="live line">
          <div className="flex items-center justify-between gap-4 bg-panel px-4 py-2.5">
            <span className="flex items-center gap-2.5">
              <span
                className={`tally-dot h-2 w-2 rounded-full ${TALLY[status].dot} ${
                  active ? "tally-live" : ""
                }`}
              />
              <span className="label !text-ink-2">{TALLY[status].text}</span>
            </span>
            <span className="label hidden sm:block">
              microphone → sound classifier + whisper → line
            </span>
          </div>

          <Ticker items={items} onExit={removeItem} />

          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 bg-panel px-4 py-2.5">
            <span className="flex items-center gap-5">
              <Channel swatch="bg-event" name="sound" example="[knock]" />
              <Channel swatch="bg-voice" name="speech" example="“sorry”" />
              <span data-sound-label={lastLabel} className="sr-only" />
            </span>
            <span className="flex items-center gap-4">
              <span className="label">speech:&nbsp;
                <span
                  data-speech-status={speechStatus}
                  className={
                    speechStatus === "error" ? "text-fault" : "text-ink-2"
                  }
                >
                  {SPEECH_LABEL[speechStatus]}
                </span>
              </span>
              <Meter peak={meter.peak} gate={meter.gate} active={active} />
            </span>
          </div>
        </section>

        <section className="mt-8" aria-label="controls">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <button
              onClick={active ? stop : start}
              disabled={status === "loading"}
              className={`rounded-[3px] px-6 py-3 text-sm font-medium transition disabled:opacity-50 ${
                active
                  ? "bg-fault text-page hover:bg-fault/90"
                  : "bg-event text-page hover:bg-event/90"
              }`}
            >
              {status === "loading"
                ? "Loading model…"
                : active
                  ? "Stop listening"
                  : "Start listening"}
            </button>
            <p className="text-xs text-ink-3">
              Chrome or Edge on desktop — WebGPU is required.
            </p>
          </div>

          <ModelPanel
            status={status}
            progress={progress}
            ready={modelReady}
            error={error}
            onRetry={start}
          />

          <DownloadNote />
        </section>

        <section className="mt-16 grid gap-x-14 gap-y-10 lg:grid-cols-2">
          <div className="prose-panel">
            <h2 className="label">what it does</h2>
            <p className="mt-3">
              SoundText listens through your microphone and writes what it hears
              to one line. A sound event appears as <code>[knock]</code>, speech
              as <code>“what time is it”</code>. The line runs right to left and
              keeps only the last few things heard.
            </p>
            <p className="mt-3">
              Two models run at once, deliberately apart: an AudioSet classifier
              for sound events (527 everyday classes) and Whisper for speech,
              gated by a voice-activity detector. Keeping them separate means
              recognizing a sentence can never delay a sound like a smoke alarm.
            </p>
            <p className="mt-3">
              All of it runs in this browser tab. Audio is never uploaded, and
              nothing is saved.
            </p>
          </div>

          <div className="prose-panel">
            <h2 className="label">how to use it</h2>
            <ol className="mt-3 space-y-4">
              <Step n={1} title="Start it">
                Press <em>Start listening</em>, then allow microphone access
                when the browser asks.
              </Step>
              <Step n={2} title="Let it load">
                The first run downloads the models — progress shows above the
                button. Later runs start immediately from the browser cache.
              </Step>
              <Step n={3} title="Read the line">
                Clap, knock, or say something out loud. Sounds show as{" "}
                <code>[clap]</code>, speech as <code>“sorry”</code>. Leave the
                tab open to keep it running; <em>Stop listening</em> ends the
                session and releases the microphone.
              </Step>
            </ol>
          </div>
        </section>

        <section className="mt-14">
          <h2 className="label">what it can’t do yet</h2>
          <ul className="mt-3 grid gap-x-14 gap-y-2 text-sm text-ink-2 sm:grid-cols-2">
            <Limit>
              It reports <em>what</em> a sound is, never where it came from or
              how far away.
            </Limit>
            <Limit>
              It cannot tell whether speech was meant for you. A nearby
              conversation and someone calling your name look the same.
            </Limit>
            <Limit>
              Quiet sounds are skipped on purpose. The gate marker on the meter
              shows where that line sits right now.
            </Limit>
            <Limit>
              No speaker labels, no history, and no Meta glasses output — the
              glasses are the planned next step.
            </Limit>
          </ul>
        </section>

        <footer className="mt-16 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-t border-rule pt-5">
          <p className="label">soundtext · proof of concept</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {notice && <span className="text-xs text-ink-3">{notice}</span>}
            <button
              onClick={cleanup}
              className="label transition hover:text-ink-2"
            >
              delete cached models
            </button>
            <a
              href={SOURCE_URL}
              className="label transition hover:text-ink-2"
              rel="noreferrer"
            >
              source
            </a>
          </div>
        </footer>
      </div>
    </main>
  );
}

const TALLY: Record<Status, { text: string; dot: string }> = {
  idle: { text: "idle", dot: "bg-ink-3" },
  loading: { text: "loading model", dot: "bg-voice" },
  listening: { text: "listening", dot: "bg-ink" },
  error: { text: "stopped — see below", dot: "bg-fault" },
};

const SPEECH_LABEL: Record<SpeechStatus, string> = {
  idle: "off",
  loading: "loading model…",
  listening: "listening",
  error: "unavailable",
};

function Channel({
  swatch,
  name,
  example,
}: {
  swatch: string;
  name: string;
  example: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-[1px] ${swatch}`} />
      <span className="label !text-ink-2">{name}</span>
      <span className="font-mono text-xs text-ink-3">{example}</span>
    </span>
  );
}

// 0.001 → 0%, 0.2 → 100%. Logarithmic, because that is how loudness reads.
function meterPct(v: number): number {
  const lo = Math.log10(0.001);
  const hi = Math.log10(0.2);
  return Math.max(
    0,
    Math.min(100, ((Math.log10(Math.max(v, 1e-4)) - lo) / (hi - lo)) * 100),
  );
}

function Meter({
  peak,
  gate,
  active,
}: {
  peak: number;
  gate: number;
  active: boolean;
}) {
  return (
    <span
      className={`flex items-center gap-2.5 transition-opacity ${
        active ? "" : "opacity-40"
      }`}
    >
      <span className="label">mic</span>
      <span className="relative h-1.5 w-28 overflow-hidden rounded-full bg-panel-2 sm:w-44">
        <span
          className="meter-fill absolute inset-y-0 left-0 rounded-full bg-event/80 transition-[width] duration-500"
          style={{ width: `${meterPct(peak)}%` }}
        />
        <span
          title="windows quieter than this are skipped"
          className="absolute inset-y-0 w-px bg-ink-2"
          style={{ left: `${meterPct(gate)}%` }}
        />
      </span>
    </span>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="mt-px font-mono text-sm text-ink-3">
        {String(n).padStart(2, "0")}
      </span>
      <span className="text-sm leading-relaxed text-ink-2">
        <strong className="font-medium text-ink">{title}</strong> — {children}
      </span>
    </li>
  );
}

function Limit({ children }: { children: ReactNode }) {
  return (
    <li className="border-t border-rule pt-2 leading-relaxed">{children}</li>
  );
}

// The honest answer to "why is the fan spinning": the first run is heavy.
function DownloadNote() {
  return (
    <div className="mt-6 border border-rule bg-panel px-4 py-3.5">
      <p className="label !text-ink-2">
        before you start — the first run downloads about 350 MB of models
      </p>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-2">
        Your browser caches them, so this happens once. Nothing downloads
        afterwards, and no audio is ever sent anywhere.
      </p>
      <details className="mt-2.5">
        <summary className="label cursor-pointer transition hover:text-ink-2">
          what is in the download
        </summary>
        <ul className="mt-2.5 max-w-sm space-y-1 font-mono text-xs text-ink-2">
          {[
            ["sound classifier · AST", "174 MB"],
            ["speech model · whisper-base", "146 MB"],
            ["speech runtime · VAD + ONNX", "28 MB"],
          ].map(([what, size]) => (
            <li key={what} className="flex justify-between gap-8">
              <span>{what}</span>
              <span className="text-ink-3">≈ {size}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

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
      return (
        <p className="label mt-6">loading model…</p>
      );
    }
    return (
      <div className="mt-6 border border-rule bg-panel px-4 py-3.5">
        <div className="flex items-baseline justify-between">
          <span className="label !text-ink-2">downloading</span>
          <span className="font-mono text-xs tabular-nums">{progress.pct}%</span>
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-panel-2">
          <div
            className="meter-fill h-full rounded-full bg-event transition-[width] duration-300"
            style={{ width: `${progress.pct}%` }}
          />
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mt-6 border border-fault/50 bg-fault/10 px-4 py-3.5">
        <div className="label !text-fault">
          {ready ? "microphone failed" : "model failed to load"}
        </div>
        <p className="mt-2 text-[13px] break-words text-ink-2">{error}</p>
        {!ready && (
          <button
            onClick={onRetry}
            className="mt-3 rounded-[3px] bg-fault px-4 py-1.5 text-xs font-medium text-page hover:bg-fault/90"
          >
            Try the download again
          </button>
        )}
      </div>
    );
  }

  return null;
}
