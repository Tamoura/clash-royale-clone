/**
 * Settings sheet: sound, haptics, motion, graphics, team colours, text
 * size, edition, tutorial and credits. Every control writes through
 * setPrefs (key 'cr-clone-settings'), so the change is saved at once and
 * subscribers (audio, renderer, CSS --text-scale) apply it live.
 * Every control is at least 44px tall.
 */
import { loadMode, otherMode, type GameMode as GameVariant } from "../../launcher/mode";
import { segmented, toast } from "../components";
import { fmtNum, tr } from "../i18n";
import { icon, type IconName } from "../icons";
import { getPrefs, onPrefs, setPrefs, type Prefs, type QualityPref, type ReduceMotion, type TeamPalette, type TextScale } from "../prefs";
import { EDITION_COPY, editionArt, switchEdition } from "./editionGate";
import { ask, openSheet } from "./frame";

export interface SettingsOpts {
  onClose?: () => void;
}

/** The tutorial keys the first-session package reads. */
const TUTORIAL_KEYS = ["cr-clone-tutorial", "cr-clone-tutored"];

function group(title: string): HTMLElement {
  const g = document.createElement("section");
  g.className = "v2-set-group";
  const h = document.createElement("h3");
  h.className = "v2-set-title";
  h.textContent = title;
  g.appendChild(h);
  return g;
}

function rowHead(ic: IconName, label: string): HTMLElement {
  const l = document.createElement("span");
  l.className = "v2-set-label";
  l.innerHTML = icon(ic);
  const t = document.createElement("span");
  t.textContent = label;
  l.appendChild(t);
  return l;
}

/** A 0..100% volume slider bound to a 0..1 pref. */
function volumeRow(ic: IconName, label: string, key: "master" | "music" | "sfx"): HTMLElement {
  const row = document.createElement("label");
  row.className = "v2-set-row v2-set-row--slider";
  row.appendChild(rowHead(ic, label));
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "100";
  input.step = "5";
  input.className = "v2-range";
  input.value = String(Math.round(getPrefs()[key] * 100));
  const out = document.createElement("output");
  out.className = "v2-set-value";
  const show = (): void => {
    out.textContent = `${fmtNum(Number(input.value))}%`;
    input.style.setProperty("--fill", `${input.value}%`);
  };
  input.addEventListener("input", () => {
    show();
    setPrefs({ [key]: Number(input.value) / 100 } as Partial<Prefs>);
  });
  show();
  row.append(input, out);
  return row;
}

/** An on/off switch row (role=switch) bound to a boolean pref. */
function switchRow(ic: IconName, label: string, key: "muted" | "haptics"): HTMLElement {
  const row = document.createElement("div");
  row.className = "v2-set-row";
  row.appendChild(rowHead(ic, label));
  const sw = document.createElement("button");
  sw.type = "button";
  sw.className = "v2-switch";
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-label", label);
  sw.dataset.pref = key;
  const show = (): void => sw.setAttribute("aria-checked", String(getPrefs()[key]));
  sw.addEventListener("click", () => {
    setPrefs({ [key]: !getPrefs()[key] } as Partial<Prefs>);
    show();
  });
  show();
  row.appendChild(sw);
  return row;
}

/** A labelled segmented control bound to a pref. */
function segRow<T>(ic: IconName, label: string, options: { value: T; label: string; blurb?: string }[], value: T, set: (v: T) => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "v2-set-row v2-set-row--stack";
  row.appendChild(rowHead(ic, label));
  row.appendChild(segmented({ options, value, onChange: set, ariaLabel: label }));
  return row;
}

/** Two team discs previewing the chosen palette. */
function paletteSwatch(p: TeamPalette): string {
  const [a, b] = p === "cb" ? ["var(--team-player-cb)", "var(--team-enemy-cb)"] : ["var(--team-player)", "var(--team-enemy)"];
  return `<span class="v2-team-swatch" aria-hidden="true"><i style="background:${a}"></i><i style="background:${b}"></i></span>`;
}

function editionGroup(): HTMLElement {
  const g = group(tr("Edition", "النسخة"));
  const current: GameVariant = loadMode(localStorage) ?? "clash";
  const tiles = document.createElement("div");
  tiles.className = "v2-set-editions";
  for (const v of ["clash", "islamic"] as GameVariant[]) {
    const c = EDITION_COPY[v];
    const t = document.createElement("button");
    t.type = "button";
    t.className = "v2-set-edition" + (v === current ? " is-current" : "");
    t.setAttribute("aria-pressed", String(v === current));
    t.appendChild(editionArt(v));
    const name = document.createElement("span");
    name.className = "v2-set-edition-name";
    name.textContent = tr(c.en, c.ar);
    t.appendChild(name);
    if (v === current) {
      const now = document.createElement("span");
      now.className = "v2-set-edition-now";
      now.innerHTML = `${icon("check")}<span>${tr("Playing", "الحالية")}</span>`;
      t.appendChild(now);
    }
    t.addEventListener("click", async () => {
      if (v === current) return;
      const ok = await ask({
        title: tr(`Switch to ${c.en}?`, `التبديل إلى ${c.ar}؟`),
        body: tr(
          "The game reloads in the other edition. Your cards, trophies and gold stay the same.",
          "ستُعاد تهيئة اللعبة بالنسخة الأخرى. تبقى بطاقاتك وكؤوسك وذهبك كما هي.",
        ),
        okLabel: tr("Switch", "بدّل"),
        cancelLabel: tr("Cancel", "إلغاء"),
      });
      if (ok) switchEdition(otherMode(current));
    });
    tiles.appendChild(t);
  }
  g.appendChild(tiles);
  return g;
}

function creditsGroup(): HTMLElement {
  const g = group(tr("Credits and licences", "الشكر والتراخيص"));
  const d = document.createElement("details");
  d.className = "v2-set-credits";
  const s = document.createElement("summary");
  s.innerHTML = `${icon("info")}<span>${tr("Show credits", "عرض الشكر")}</span>`;
  d.appendChild(s);
  const list = document.createElement("ul");
  const items: [string, string][] = [
    ["Lilita One font: SIL Open Font License 1.1", "خط Lilita One: رخصة SIL للخطوط المفتوحة 1.1"],
    ["Baloo Bhaijaan 2 font: SIL Open Font License 1.1", "خط Baloo Bhaijaan 2: رخصة SIL للخطوط المفتوحة 1.1"],
    ["three.js 3D engine: MIT License", "محرك three.js ثلاثي الأبعاد: رخصة MIT"],
    [
      "All art, characters, icons, music and sounds are original or procedural.",
      "كل الرسوم والشخصيات والأيقونات والموسيقى والأصوات أصلية أو مولّدة برمجيًا.",
    ],
    [
      "A fan-made tribute. Not affiliated with or endorsed by any game studio.",
      "عمل هواة تكريمي، غير تابع لأي استوديو ألعاب ولا معتمد منه.",
    ],
  ];
  for (const [en, ar] of items) {
    const li = document.createElement("li");
    li.textContent = tr(en, ar);
    list.appendChild(li);
  }
  d.appendChild(list);
  g.appendChild(d);
  return g;
}

/** Build the settings content (exported for tests and embedding). */
export function buildSettings(): HTMLElement {
  const p = getPrefs();
  const root = document.createElement("div");
  root.className = "v2-settings";

  // ---- Sound
  const sound = group(tr("Sound", "الصوت"));
  sound.append(
    volumeRow("sound", tr("Master volume", "الصوت العام"), "master"),
    volumeRow("music", tr("Music", "الموسيقى"), "music"),
    volumeRow("sfx", tr("Effects", "المؤثرات"), "sfx"),
    switchRow("mute", tr("Mute everything", "كتم كل الأصوات"), "muted"),
  );
  root.appendChild(sound);

  // ---- Feel
  const feel = group(tr("Feel", "الإحساس"));
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    feel.appendChild(switchRow("vibrate", tr("Vibration", "الاهتزاز"), "haptics"));
  }
  feel.appendChild(
    segRow<ReduceMotion>(
      "motion",
      tr("Reduce motion", "تقليل الحركة"),
      [
        { value: "auto", label: tr("Auto", "تلقائي"), blurb: tr("Follows your device setting", "يتبع إعداد جهازك") },
        { value: "on", label: tr("On", "تشغيل"), blurb: tr("Fewer shakes, flashes and slides", "اهتزاز ووميض وانزلاق أقل") },
        { value: "off", label: tr("Off", "إيقاف"), blurb: tr("Full animation", "حركة كاملة") },
      ],
      p.reduceMotion,
      (v) => setPrefs({ reduceMotion: v }),
    ),
  );
  root.appendChild(feel);

  // ---- Display
  const display = group(tr("Display", "العرض"));
  display.appendChild(
    segRow<QualityPref>(
      "sparkle",
      tr("Graphics", "الرسوميات"),
      [
        { value: "auto", label: tr("Auto", "تلقائي"), blurb: tr("Adapts to keep the game smooth", "يتكيّف لتبقى اللعبة سلسة") },
        { value: "low", label: tr("Low", "منخفض"), blurb: tr("Saves battery on older phones", "يوفّر البطارية في الهواتف القديمة") },
        { value: "medium", label: tr("Medium", "متوسط"), blurb: tr("Balanced detail and speed", "توازن بين التفاصيل والسرعة") },
        { value: "high", label: tr("High", "عالٍ"), blurb: tr("Every shadow and glow", "كل الظلال والتوهج") },
      ],
      p.quality,
      (v) => setPrefs({ quality: v }),
    ),
  );
  const teamRow = segRow<TeamPalette>(
    "palette",
    tr("Team colours", "ألوان الفريقين"),
    [
      { value: "default", label: tr("Blue / red", "أزرق / أحمر"), blurb: tr("You are blue, the opponent is red", "أنت بالأزرق والخصم بالأحمر") },
      { value: "cb", label: tr("Colour-blind", "لعمى الألوان"), blurb: tr("Blue against orange, easier to tell apart", "أزرق مقابل برتقالي، أسهل في التمييز") },
    ],
    p.teamPalette,
    (v) => {
      setPrefs({ teamPalette: v });
      preview.innerHTML = paletteSwatch(v);
    },
  );
  const preview = document.createElement("span");
  preview.className = "v2-set-preview";
  preview.innerHTML = paletteSwatch(p.teamPalette);
  teamRow.querySelector(".v2-set-label")?.appendChild(preview);
  display.appendChild(teamRow);
  display.appendChild(
    segRow<TextScale>(
      "text",
      tr("Text size", "حجم النص"),
      ([1, 1.15, 1.3] as TextScale[]).map((v) => ({ value: v, label: `${fmtNum(Math.round(v * 100))}%` })),
      p.textScale,
      (v) => setPrefs({ textScale: v }),
    ),
  );
  root.appendChild(display);

  root.appendChild(editionGroup());

  // ---- Help
  const help = group(tr("Help", "المساعدة"));
  const tut = document.createElement("button");
  tut.type = "button";
  tut.className = "v2-set-action";
  tut.innerHTML = `${icon("book")}<span>${tr("Replay the tutorial", "أعد الدرس التعليمي")}</span>`;
  tut.addEventListener("click", () => {
    try {
      for (const k of TUTORIAL_KEYS) localStorage.removeItem(k);
    } catch {
      // storage blocked: nothing to reset
    }
    toast(tr("The tutorial will play in your next battle.", "سيبدأ الدرس التعليمي في معركتك القادمة."), "success");
  });
  help.appendChild(tut);
  root.appendChild(help);

  root.appendChild(creditsGroup());
  return root;
}

/** Open the Settings sheet. Safe to call from any screen. */
export function openSettings(opts: SettingsOpts = {}): { close: () => void } {
  const content = buildSettings();
  // Keep the switches honest if another screen changes a pref meanwhile.
  const off = onPrefs((p) => {
    content.querySelectorAll<HTMLElement>(".v2-switch[data-pref]").forEach((sw) => {
      const key = sw.dataset.pref as "muted" | "haptics";
      sw.setAttribute("aria-checked", String(p[key]));
    });
  });
  const s = openSheet({
    title: tr("Settings", "الإعدادات"),
    content,
    className: "v2-settings-sheet",
    onClose: () => {
      off();
      opts.onClose?.();
    },
  });
  return { close: s.close };
}
