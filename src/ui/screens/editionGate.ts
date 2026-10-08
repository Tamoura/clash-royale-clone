/**
 * Edition gate (first visit): two painted cards — Classic and Golden Age —
 * each with a crest, a skyline and a bilingual title and tagline, and one
 * Continue button. Arabic-language browsers start on the Islamic card.
 *
 * Picking reloads the page into the chosen edition; a session flag keeps
 * the #boot splash up until the new page has drawn its first frame, so the
 * switch never flashes an unstyled page.
 */
import type { AppCtx } from "../../app/ctx";
import { on } from "../../app/hooks";
import { saveMode, type GameMode as GameVariant } from "../../launcher/mode";
import { button } from "../components";
import { applyMotion } from "./frame";

const SPLASH_HOLD_KEY = "cr-clone-splash-hold";

/** Keep the boot splash over the coming reload. */
export function holdSplashForReload(): void {
  try {
    sessionStorage.setItem(SPLASH_HOLD_KEY, "1");
  } catch {
    // no session storage: the reload just shows the page sooner
  }
}

/** Switch edition: persist it, cover the reload with the splash, reload. */
export function switchEdition(v: GameVariant): void {
  try {
    saveMode(localStorage, v);
  } catch {
    return; // storage blocked: the choice cannot survive a reload
  }
  holdSplashForReload();
  location.reload();
}

// A held splash (set before the reload) stays until the first frame, then fades.
(function releaseHeldSplash(): void {
  if (typeof document === "undefined") return;
  let held = false;
  try {
    held = sessionStorage.getItem(SPLASH_HOLD_KEY) === "1";
    sessionStorage.removeItem(SPLASH_HOLD_KEY);
  } catch {
    held = false;
  }
  if (!held) return;
  document.body.classList.add("v2-splash-hold");
  const off = on("frame", () => {
    off();
    requestAnimationFrame(() => {
      document.body.classList.add("v2-splash-out");
      window.setTimeout(() => document.body.classList.remove("v2-splash-hold", "v2-splash-out"), 420);
    });
  });
})();

// ---- Art --------------------------------------------------------------------------

/** Points of an n-pointed star, as an SVG path. */
function starPath(cx: number, cy: number, outer: number, inner: number, points: number, rot = -Math.PI / 2): string {
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i * Math.PI) / points;
    d += `${i === 0 ? "M" : "L"}${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  }
  return `${d}Z`;
}

const INK = 'stroke="#1a1030" stroke-width="2.4" stroke-linejoin="round"';

const CREST: Record<GameVariant, string> = {
  clash:
    `<svg class="v2-crest" viewBox="0 0 64 72" aria-hidden="true">` +
    `<path ${INK} fill="#f2b632" d="M32 3 58 11v20c0 17-11 30-26 38C17 61 6 48 6 31V11z"/>` +
    `<path fill="#2a72d4" d="M32 9.5 52.5 16v15.5c0 13.5-8.5 24-20.5 30.5C20 55.5 11.5 45 11.5 31.5V16z"/>` +
    `<path fill="#4f8cff" d="M32 9.5 52.5 16v15.5c0 2-.2 4-.6 5.9L32 22z" opacity=".55"/>` +
    `<path ${INK} fill="#ffd23f" d="M18 44 20 25.5l7.5 6.5L32 20l4.5 12 7.5-6.5L46 44z"/>` +
    `<rect ${INK} fill="#f2a31b" x="18" y="44" width="28" height="6" rx="2"/>` +
    `<circle fill="#e8413b" cx="32" cy="47" r="2"/><circle fill="#fff6c9" cx="20" cy="25" r="2"/>` +
    `<circle fill="#fff6c9" cx="32" cy="19.5" r="2"/><circle fill="#fff6c9" cx="44" cy="25" r="2"/>` +
    `</svg>`,
  islamic:
    `<svg class="v2-crest" viewBox="0 0 64 72" aria-hidden="true">` +
    `<path ${INK} fill="#e0b54a" d="${starPath(32, 36, 30, 23.5, 8, -Math.PI / 2 + Math.PI / 8)}"/>` +
    `<circle fill="#0e7c84" cx="32" cy="36" r="19"/>` +
    `<circle fill="none" stroke="#e8c060" stroke-width="1.4" stroke-dasharray="2 2.6" cx="32" cy="36" r="16"/>` +
    `<path ${INK} fill="#ffe08a" d="M37.5 24.5a12.5 12.5 0 1 0 0 23 10 10 0 1 1 0-23z"/>` +
    `<path fill="#ffe08a" stroke="#1a1030" stroke-width="1.2" stroke-linejoin="round" d="${starPath(40, 36, 5.6, 2.4, 5)}"/>` +
    `</svg>`,
};

const SKYLINE: Record<GameVariant, string> = {
  clash:
    `<svg class="v2-skyline" viewBox="0 0 120 90" preserveAspectRatio="xMidYMax slice" aria-hidden="true">` +
    `<path fill="#16244a" d="M0 90V62h4V40h3v-5h4v5h3v-5h4v5h3v22h19V34l20-18 20 18v28h19V40h3v-5h4v5h3v-5h4v5h3v22h4v28z"/>` +
    `<path fill="#0b142e" d="M52 90V78a8 8 0 0 1 16 0v12zM10 48h4v6h-4zM106 48h4v6h-4zM58 38h4v7h-4z"/>` +
    `<path fill="none" stroke="#16244a" stroke-width="1.6" d="M60 17V4"/><path fill="#e8413b" d="M61 4l10 3.5-10 3.5z"/>` +
    `</svg>`,
  islamic:
    `<svg class="v2-skyline" viewBox="0 0 120 90" preserveAspectRatio="xMidYMax slice" aria-hidden="true">` +
    `<path fill="#05303a" d="M0 90V80h8V36H6l6-14 6 14h-2v44h14V62h4c0-18 12-30 26-40 14 10 26 22 26 40h4v18h14V36h-2l6-14 6 14h-2v44h8v10z"/>` +
    `<path fill="#e8c060" d="M62 11a4 4 0 1 0 0 6.5 3.2 3.2 0 1 1 0-6.5z"/>` +
    `<path fill="#021c24" d="M54 90V78a6 6 0 0 1 12 0v12zM38 90v-9a3 3 0 0 1 6 0v9zM76 90v-9a3 3 0 0 1 6 0v9zM10.5 44h3v5h-3zM106.5 44h3v5h-3z"/>` +
    `</svg>`,
};

export interface EditionCopy {
  en: string;
  ar: string;
  tagEn: string;
  tagAr: string;
}

export const EDITION_COPY: Record<GameVariant, EditionCopy> = {
  clash: {
    en: "Classic",
    ar: "كلاسيك",
    tagEn: "Knights, wizards and castle towers",
    tagAr: "فرسان وسحرة وأبراج القلاع",
  },
  islamic: {
    en: "Golden Age",
    ar: "العصر الذهبي",
    tagEn: "Faris riders, camels and crescent towers",
    tagAr: "فرسان وجِمال وأبراج الهلال",
  },
};

/** The painted art panel (sky, skyline, crest) for an edition. */
export function editionArt(v: GameVariant): HTMLElement {
  const art = document.createElement("div");
  art.className = `v2-edition-art v2-edition-art--${v}`;
  art.innerHTML = SKYLINE[v] + CREST[v];
  return art;
}

/** One tall, bilingual edition card (a radio in the gate's group). */
function editionCard(v: GameVariant, selected: boolean, onPick: () => void): HTMLButtonElement {
  const c = EDITION_COPY[v];
  const b = document.createElement("button");
  b.type = "button";
  b.className = `v2-edition-card v2-edition-card--${v}`;
  b.dataset.edition = v;
  b.setAttribute("role", "radio");
  b.setAttribute("aria-checked", String(selected));
  b.setAttribute("aria-label", `${c.en} · ${c.ar}`);
  b.appendChild(editionArt(v));
  const text = document.createElement("div");
  text.className = "v2-edition-text";
  text.innerHTML =
    `<span class="v2-edition-title" lang="en"></span>` +
    `<span class="v2-edition-title v2-ar" lang="ar" dir="rtl"></span>` +
    `<span class="v2-edition-tag" lang="en"></span>` +
    `<span class="v2-edition-tag v2-ar" lang="ar" dir="rtl"></span>`;
  const [t1, t2, g1, g2] = Array.from(text.children) as HTMLElement[];
  t1.textContent = c.en;
  t2.textContent = c.ar;
  g1.textContent = c.tagEn;
  g2.textContent = c.tagAr;
  b.appendChild(text);
  const tick = document.createElement("span");
  tick.className = "v2-edition-tick";
  tick.setAttribute("aria-hidden", "true");
  b.appendChild(tick);
  b.addEventListener("click", onPick);
  return b;
}

function preferredEdition(): GameVariant {
  try {
    return (navigator.language || "").toLowerCase().startsWith("ar") ? "islamic" : "clash";
  } catch {
    return "clash";
  }
}

/** First-visit gate: nothing else is reachable until an edition is picked. */
export function buildEditionGate(ctx: AppCtx): void {
  const { pickerRoot } = ctx;
  pickerRoot.innerHTML = "";
  pickerRoot.removeAttribute("dir");
  const gate = document.createElement("div");
  gate.className = "v2-gate";
  applyMotion(gate);

  const head = document.createElement("div");
  head.className = "v2-gate-head";
  head.innerHTML =
    `<h1 class="v2-gate-title"><span lang="en">Choose your edition</span>` +
    `<span class="v2-ar" lang="ar" dir="rtl">اختر نسختك</span></h1>` +
    `<p class="v2-gate-sub"><span lang="en">You can switch any time in Settings</span>` +
    `<span class="v2-ar" lang="ar" dir="rtl">يمكنك التبديل في أي وقت من الإعدادات</span></p>`;
  gate.appendChild(head);

  let choice: GameVariant = preferredEdition();
  const group = document.createElement("div");
  group.className = "v2-gate-cards";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Edition · النسخة");
  const cards = (["clash", "islamic"] as GameVariant[]).map((v) =>
    editionCard(v, v === choice, () => {
      choice = v;
      for (const c of cards) {
        const on = c.dataset.edition === v;
        c.setAttribute("aria-checked", String(on));
      }
    }),
  );
  group.append(...cards);
  group.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next = cards.find((c) => c.dataset.edition !== choice);
    next?.click();
    next?.focus();
  });
  gate.appendChild(group);

  const cta = button({
    variant: "cta",
    size: "lg",
    label: "Continue · متابعة",
    onClick: () => {
      cta.disabled = true;
      switchEdition(choice);
    },
  });
  cta.classList.add("v2-gate-cta");
  gate.appendChild(cta);

  pickerRoot.appendChild(gate);
}
