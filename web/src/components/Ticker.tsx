import { useEffect, useRef } from "react";

export type TickerItem = {
  id: number;
  kind: "sound" | "speech";
  text: string;
};

// Gap between tokens (the "..." in [clap]...[crash]."sorry"), and how fast the
// line moves. Constant speed, so tokens enter from the right and exit left.
const GAP = 28;
const SPEED = 70;

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

  return (
    <div
      ref={viewport}
      className="relative h-20 w-full overflow-hidden border-y border-neutral-800 bg-neutral-900/40"
    >
      {items.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-700">
          waiting for sound or speech…
        </div>
      )}
      {items.map((it) => (
        <span
          key={it.id}
          ref={register(it.id)}
          style={{ transform: "translateX(100vw)" }}
          className={`absolute inset-y-0 flex items-center whitespace-nowrap text-lg font-medium ${
            it.kind === "sound" ? "text-emerald-400" : "text-sky-300"
          }`}
        >
          {it.kind === "sound" ? `[${it.text}]` : `“${it.text}”`}
          <span className="ml-1 text-neutral-700">…</span>
        </span>
      ))}
    </div>
  );
}
