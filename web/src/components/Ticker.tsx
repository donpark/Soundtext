import { useEffect, useRef } from "react";

export type TickerKind = "sound" | "speech";

export type TickerItem = {
  id: number;
  kind: TickerKind;
  text: string;
};

// Gap between tokens (the "..." in [clap]...[crash]."sorry"), and how fast the
// line moves. Constant speed, so tokens enter from the right and exit left.
const GAP = 28;
// Faster than the 18px-era 70px/s so the larger tokens pass at the same rate.
const SPEED = 90;

// How one item renders: sounds are bracketed, speech is in quotes.
export function tickerToken(it: TickerItem): string {
  return it.kind === "sound" ? `[${it.text}]` : `“${it.text}”`;
}

// Single-line rendering of the tail of a lane, e.g. `[clap]…[crash]…`. This is
// the form a Meta glasses layout would send: the display gets whole snapshots
// (no partial updates), so the browser's pixel scroll is approximated by
// re-sending this window whenever a token is added or expires.
export function tickerText(items: TickerItem[], max = 8): string {
  return items.slice(-max).map(tickerToken).join("…");
}

const LANE: Record<TickerKind, { name: string; swatch: string }> = {
  sound: { name: "sound", swatch: "bg-event" },
  speech: { name: "speech", swatch: "bg-voice" },
};

// One lane of the display. Sound events and speech scroll independently: they
// are separate pipelines with different latencies, so sharing a line would let
// a slow transcript hold up a safety-relevant sound.
export function Ticker({
  kind,
  items,
  onExit,
}: {
  kind: TickerKind;
  items: TickerItem[];
  onExit: (id: number) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<number, HTMLElement>());
  const pos = useRef(new Map<number, { x: number; w: number }>());
  const exit = useRef(onExit);
  exit.current = onExit;

  const register = (id: number) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  };

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); // clamp after a tab stall
      last = now;
      const vw = viewport.current?.clientWidth ?? 0;

      // Place newly attached tokens first. This has to happen here rather than
      // in the ref callback: child refs run before the parent's, so the
      // viewport width isn't known yet at that point.
      let rightmost = 0;
      for (const p of pos.current.values()) {
        rightmost = Math.max(rightmost, p.x + p.w);
      }
      for (const [id, el] of nodes.current) {
        if (pos.current.has(id)) continue;
        const w = el.offsetWidth;
        const x = Math.max(vw, rightmost + GAP);
        pos.current.set(id, { x, w });
        rightmost = x + w;
        el.style.transform = `translateX(${x}px)`;
      }

      for (const [id, p] of pos.current) {
        p.x -= SPEED * dt;
        if (p.x + p.w < -GAP) {
          pos.current.delete(id);
          nodes.current.delete(id);
          exit.current(id);
          continue;
        }
        const el = nodes.current.get(id);
        if (el) el.style.transform = `translateX(${p.x}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const latest = items.at(-1);
  const lane = LANE[kind];

  return (
    <div
      data-lane={kind}
      className="flex items-stretch border-b border-rule last:border-b-0"
    >
      <div className="flex w-20 shrink-0 items-center gap-2 border-r border-rule px-3 sm:w-28 sm:px-4">
        <span className={`h-2 w-2 rounded-[1px] ${lane.swatch}`} />
        <span className="label !text-ink-2">{lane.name}</span>
      </div>

      <div
        ref={viewport}
        className="relative h-14 min-w-0 flex-1 overflow-hidden bg-panel-2/50 sm:h-[72px]"
      >
        {items.length === 0 && (
          <span className="label absolute inset-y-0 left-4 flex items-center">
            —
          </span>
        )}
        {items.map((it) => (
          <span
            key={it.id}
            ref={register(it.id)}
            // Test hooks: a check reads the line from here, never from page text.
            data-ticker-kind={it.kind}
            data-ticker-item={tickerToken(it)}
            style={{ transform: "translateX(100vw)" }}
            className={`absolute inset-y-0 flex items-center whitespace-nowrap font-mono text-xl sm:text-[28px] ${
              it.kind === "sound" ? "text-event" : "text-voice"
            }`}
          >
            {tickerToken(it)}
            <span className="ml-2 text-ink-3">…</span>
          </span>
        ))}
        {/* Announced one token at a time: the visual line is an endless scroll,
            which is noise to a screen reader. */}
        <p aria-live="polite" className="sr-only">
          {latest
            ? latest.kind === "sound"
              ? `sound: ${latest.text}`
              : `speech: ${latest.text}`
            : ""}
        </p>
      </div>
    </div>
  );
}
