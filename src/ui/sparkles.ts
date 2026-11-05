/**
 * Sparkle fields for the big reward moments (the legendary card build-up
 * in the chest reveal, the 3-crown celebration). The layout is a pure,
 * seeded function (unit-tested); the DOM part only turns it into absolutely
 * positioned spans that styles/rewards.css animates (.rw-spark). Callers
 * skip it entirely when motion is reduced.
 */

export interface Spark {
  /** Start position, % of the host (0..100). */
  x: number;
  y: number;
  /** Drift while it rises, in px (negative = toward the inline start). */
  dx: number;
  /** Rise height in px. */
  rise: number;
  /** Size in px. */
  size: number;
  /** Delay and duration in ms. */
  delay: number;
  dur: number;
  /** Palette index (0..3): gold, white, and two accent tints. */
  hue: number;
}

/** Deterministic 0..1 generator (mulberry32), so a layout never jitters between runs. */
function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SparkleOpts {
  count?: number;
  seed?: number;
  /** "rise": a slow upward drift (build-up); "burst": a quick spray outwards. */
  mode?: "rise" | "burst";
}

/** Where each sparkle starts and how it moves. */
export function sparkleField(o: SparkleOpts = {}): Spark[] {
  const count = Math.max(0, Math.min(64, Math.floor(o.count ?? 18)));
  const r = rand(o.seed ?? 7);
  const burst = o.mode === "burst";
  const out: Spark[] = [];
  for (let i = 0; i < count; i++) {
    // Spread evenly round the centre with a little jitter, so no clumps.
    const a = ((i + r() * 0.6) / Math.max(1, count)) * Math.PI * 2;
    const ring = burst ? 4 + r() * 8 : 18 + r() * 26;
    out.push({
      x: 50 + Math.cos(a) * ring,
      y: (burst ? 46 : 58) + Math.sin(a) * ring * (burst ? 1 : 0.8),
      dx: Math.round(Math.cos(a) * (burst ? 90 + r() * 90 : 6 + r() * 18)),
      rise: Math.round(burst ? Math.sin(a) * (90 + r() * 90) * -1 + 20 : 60 + r() * 90),
      size: Math.round((burst ? 8 : 6) + r() * (burst ? 12 : 9)),
      delay: Math.round(burst ? r() * 120 : r() * 1400),
      dur: Math.round(burst ? 700 + r() * 400 : 1300 + r() * 900),
      hue: i % 4,
    });
  }
  return out;
}

/**
 * Mount a sparkle field in `host` (positioned) and return the layer; it
 * removes itself after `lifeMs` when given.
 */
export function mountSparkles(host: HTMLElement, o: SparkleOpts & { className?: string; lifeMs?: number } = {}): HTMLElement {
  const layer = document.createElement("div");
  layer.className = `rw-sparks${o.mode === "burst" ? " rw-sparks--burst" : ""}${o.className ? ` ${o.className}` : ""}`;
  layer.setAttribute("aria-hidden", "true");
  for (const s of sparkleField(o)) {
    const i = document.createElement("i");
    i.className = `rw-spark rw-spark--h${s.hue}`;
    i.style.left = `${s.x}%`;
    i.style.top = `${s.y}%`;
    i.style.width = i.style.height = `${s.size}px`;
    i.style.setProperty("--dx", `${s.dx}px`);
    i.style.setProperty("--rise", `${s.rise}px`);
    i.style.animationDelay = `${s.delay}ms`;
    i.style.animationDuration = `${s.dur}ms`;
    layer.appendChild(i);
  }
  host.appendChild(layer);
  if (o.lifeMs) window.setTimeout(() => layer.remove(), o.lifeMs);
  return layer;
}
