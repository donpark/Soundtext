import { useEffect, useRef } from "react";

export type TickerItem = {
  id: number;
  kind: "sound" | "speech";
  text: string;
};

// Gap between tokens (the "..." in [clap]...[crash]."sorry"), and how fast the
// line moves. Constant speed, so tokens enter from the right and exit left.
const GAP = 28;
// Faster than the 18px-era 70px/s so the larger tokens pass at the same rate.
const SPEED = 90;

// Single-line rendering of the tail of the queue, e.g. `[clap]…"sorry"…`.
// This is the form a Meta glasses layout would send: the display gets whole
// snapshots (no partial updates), so the browser's pixel scroll is approximated
// by re-sending this window whenever a token is added or expires.
export function tickerText(items: TickerItem[], max = 8): string {
  return items
    .slice(-max)
    .map((it) => (it.kind === "sound" ? `[${it.text}]` : `“${it.text}”`))
    .join("…");
}

// Band is deliberately shorter than it is loud: the line is the display, the
// strip around it is the frame.
export function Ticker({
  items,
  onExit,
}: {
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

  return (
    <div
      ref={viewport}
      className="relative h-24 w-full overflow-hidden border-y border-rule bg-panel-2/50"
    >
      {items.length === 0 && (
        <div className="label absolute inset-0 flex items-center justify-center">
          nothing heard yet
        </div>
      )}
      {items.map((it) => (
        <span
          key={it.id}
          ref={register(it.id)}
          style={{ transform: "translateX(100vw)" }}
          className={`absolute inset-y-0 flex items-center whitespace-nowrap font-mono text-2xl sm:text-[34px] ${
            it.kind === "sound" ? "text-event" : "text-voice"
          }`}
        >
          {it.kind === "sound" ? `[${it.text}]` : `“${it.text}”`}
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
  );
}
