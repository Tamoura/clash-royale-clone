/**
 * Character Studio: design your one champion card — stats, capabilities
 * and a look — with a live 3D preview and a computed elixir price.
 */
import * as THREE from "three";
import type { AppCtx } from "../../app/ctx";
import {
  CHAMPION_LIMITS,
  CHAMPION_PALETTE,
  DEFAULT_CHAMPION,
  MAX_CHAMPION_COST,
  championCostInfo,
  deleteChampion,
  hasSavedChampion,
  loadChampion,
  normalizeChampion,
  saveChampion,
  type ChampionDef,
} from "../../game/customcard";
import { clampDeckToOwned, ownedSet } from "../../meta/progress";
import { invalidatePortrait } from "../../render3d/cardportraits";
import { animateTroop, buildChampionRig, type TroopRig } from "../../render3d/characters3d";
import { disposeDeep } from "../../render3d/scene3d";
import { on } from "../../app/hooks";
import { button } from "../components";
import { fmtNum, tr } from "../i18n";
import { icon, type IconName } from "../icons";
import { ask, mountSubscreen } from "./frame";

// ---- Character Studio ----------------------------------------------------
// Design a card: pick stats, capabilities, and a look. Elixir cost is not
// chosen — it's computed live from what the design can do (customcard.ts).

let studioAnim = 0;
let studioCleanup: (() => void) | null = null;

export function openStudio(ctx: AppCtx): void {
  buildStudio(ctx, loadChampion());
}

// Leaving the Studio by any route stops its preview renderer.
on("screen", (s) => {
  if (s.id !== "studio") closeStudio();
});

function closeStudio(): void {
  cancelAnimationFrame(studioAnim);
  studioCleanup?.();
  studioCleanup = null;
}

function buildStudio(ctx: AppCtx, def: ChampionDef): void {
  const { meta } = ctx;
  closeStudio();
  let cur = normalizeChampion(def);

  const saveBtn = button({
    variant: "cta",
    size: "lg",
    icon: "save",
    label: tr("Save champion", "احفظ البطل"),
    onClick: () => {
      cur.name = cur.name.trim() || "Champion";
      if (!saveChampion(cur)) return; // over budget: the guardrail refused
      invalidatePortrait("champion");
      if (!meta.profile.owned.includes("champion")) {
        meta.profile = { ...meta.profile, owned: [...meta.profile.owned, "champion"] };
      }
      ctx.persistProfile();
      closeStudio();
      ctx.openDeckPicker({ mode: "deck" }); // slot it straight into the deck
    },
  });
  const saveLabel = saveBtn.querySelector<HTMLElement>(".ui-btn__label")!;
  const footer = document.createElement("div");
  footer.appendChild(saveBtn);

  let pickerRoot: HTMLElement = document.createElement("div");
  mountSubscreen(ctx, {
    id: "studio",
    title: tr("Champion Studio", "ورشة البطل"),
    footer,
    onLeave: closeStudio,
    build: (body) => {
      body.classList.add("v2-studio");
      pickerRoot = body;
    },
  });

  const hint = document.createElement("p");
  hint.className = "v2-hint";
  hint.textContent = hasSavedChampion()
    ? tr("You have one champion. Saving replaces it.", "لديك بطل واحد. الحفظ يستبدله.")
    : tr(
        "Design your one champion. Its elixir price follows its power.",
        "صمّم بطلك الواحد. سعر الإكسير يتبع قوته.",
      );
  pickerRoot.appendChild(hint);

  const wrap = document.createElement("div");
  wrap.className = "studio-wrap";
  pickerRoot.appendChild(wrap);

  // -- Live 3D preview + computed cost --------------------------------
  const previewPane = document.createElement("div");
  previewPane.className = "studio-preview";
  wrap.appendChild(previewPane);

  const costBadge = document.createElement("div");
  costBadge.className = "studio-cost";
  costBadge.title = tr("Elixir cost — computed from the design", "تكلفة الإكسير — محسوبة من التصميم");
  previewPane.appendChild(costBadge);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(230, 250);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  previewPane.appendChild(renderer.domElement);

  const summary = document.createElement("div");
  summary.className = "studio-summary";
  previewPane.appendChild(summary);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x4a5070, 1.3));
  const key = new THREE.DirectionalLight(0xfff2d8, 2.2);
  key.position.set(3, 5, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb6ff, 1.2);
  rim.position.set(-4, 3, -3);
  scene.add(rim);
  const pivot = new THREE.Group();
  scene.add(pivot);
  const camera = new THREE.PerspectiveCamera(30, 230 / 250, 0.1, 30);

  let rig: TroopRig | null = null;
  function rebuildRig(): void {
    if (rig) {
      pivot.remove(rig.group);
      disposeDeep(rig.group);
    }
    rig = buildChampionRig(cur);
    pivot.add(rig.group);
    const h = (rig.hover ?? 0) + rig.height;
    camera.position.set(0, h * 0.62, h * 2.5);
    camera.lookAt(0, h * 0.5, 0);
  }

  let walking = true;
  const t0 = performance.now();
  const loop = (): void => {
    studioAnim = requestAnimationFrame(loop);
    const t = (performance.now() - t0) / 1000;
    if (rig) animateTroop(rig, { moving: walking, swing: 0, time: t, phase: 0 });
    pivot.rotation.y = 0.55 + t * 0.5;
    renderer.render(scene, camera);
  };
  loop();
  studioCleanup = () => {
    if (rig) disposeDeep(rig.group);
    renderer.dispose();
  };

  // -- Controls --------------------------------------------------------
  const controls = document.createElement("div");
  controls.className = "studio-controls";
  wrap.appendChild(controls);

  const refreshers: (() => void)[] = [];
  function refresh(): void {
    cur = normalizeChampion(cur);
    const info = championCostInfo(cur);
    // Over budget: show the HONEST price in red — a design worth more
    // than the elixir bar can pay is blocked, never discounted to 10.
    costBadge.textContent = fmtNum(info.overBudget ? info.raw : info.cost);
    costBadge.classList.toggle("over", info.overBudget);
    const speedName: Record<ChampionDef["speed"], [string, string]> = {
      slow: ["slow", "بطيء"],
      medium: ["medium", "متوسط"],
      fast: ["fast", "سريع"],
    };
    const bits = [
      tr(
        `${cur.count > 1 ? `×${fmtNum(cur.count)} · ` : ""}${fmtNum(cur.hp)} HP · ${fmtNum(cur.damage)} damage`,
        `${cur.count > 1 ? `×${fmtNum(cur.count)} · ` : ""}${fmtNum(cur.hp)} صحة · ${fmtNum(cur.damage)} ضرر`,
      ),
      tr(
        `every ${fmtNum(Number(cur.hitSpeed.toFixed(1)))}s · ${cur.range <= 1 ? "melee" : `range ${fmtNum(cur.range)}`} · ${speedName[cur.speed][0]}`,
        `كل ${fmtNum(Number(cur.hitSpeed.toFixed(1)))} ث · ${cur.range <= 1 ? "التحام" : `مدى ${fmtNum(cur.range)}`} · ${speedName[cur.speed][1]}`,
      ),
    ];
    const caps = Object.entries(cur.abilities)
      .filter(([, on]) => on)
      .map(([k]) => capText(k as keyof ChampionDef["abilities"]));
    if (caps.length) bits.push(caps.join(" · "));
    if (info.overBudget) {
      bits.push(
        `<span class="studio-warning">` +
          tr(
            `Worth ${fmtNum(info.raw)} elixir, but the bar only holds ${fmtNum(MAX_CHAMPION_COST)}. Tone it down to save.`,
            `يستحق ${fmtNum(info.raw)} إكسير، والحد الأقصى ${fmtNum(MAX_CHAMPION_COST)}. خفّف القوة للحفظ.`,
          ) +
          `</span>`,
      );
    }
    summary.innerHTML = bits.map((b) => `<div>${b}</div>`).join("");
    saveBtn.disabled = info.overBudget;
    saveLabel.textContent = info.overBudget
      ? tr(`Too powerful (worth ${fmtNum(info.raw)})`, `قوي جدًا (${fmtNum(info.raw)})`)
      : tr("Save champion", "احفظ البطل");
    for (const r of refreshers) r();
    rebuildRig();
  }

  function row(label: string): HTMLElement {
    const r = document.createElement("label");
    r.className = "studio-row";
    const l = document.createElement("span");
    l.textContent = label;
    r.appendChild(l);
    controls.appendChild(r);
    return r;
  }

  // Name.
  {
    const r = row(tr("Name", "الاسم"));
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = CHAMPION_LIMITS.nameLength;
    input.value = cur.name;
    input.addEventListener("input", () => {
      cur.name = input.value || "Champion"; // name never affects the price
    });
    r.appendChild(input);
  }

  function slider(
    label: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    set: (v: number) => void,
    fmt: (v: number) => string = (v) => fmtNum(v),
  ): void {
    const r = row(label);
    const out = document.createElement("b");
    const input = document.createElement("input");
    input.type = "range";
    input.className = "v2-range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    input.addEventListener("input", () => {
      set(Number(input.value));
      refresh();
    });
    refreshers.push(() => {
      out.textContent = fmt(get());
      input.value = String(get());
      input.style.setProperty("--fill", `${((get() - min) / (max - min)) * 100}%`);
    });
    r.appendChild(input);
    r.appendChild(out);
  }

  // One-tap starting points — each showcases a different corner of the
  // pricing model; Surprise rerolls until the design fits the budget.
  {
    const r = row(tr("Presets", "قوالب"));
    const rowEl = document.createElement("div");
    rowEl.className = "studio-presets";
    const preset = (ic: IconName, label: string, apply: () => void): void => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "studio-walk v2-chipbtn";
      b.innerHTML = `${icon(ic)}<span></span>`;
      b.querySelector("span")!.textContent = label;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        apply();
        refresh();
      });
      rowEl.appendChild(b);
    };
    const setAll = (p: Partial<ChampionDef>, caps: Partial<ChampionDef["abilities"]>): void => {
      Object.assign(cur, p);
      cur.abilities = { ...normalizeChampion(DEFAULT_CHAMPION).abilities, ...caps };
    };
    preset("shield", tr("Tank", "درع"), () =>
      setAll(
        { count: 1, hp: 3400, damage: 230, hitSpeed: 1.6, range: 0.8, speed: "slow" },
        { buildingsOnly: true },
      ),
    );
    preset("target", tr("Sniper", "قنّاص"), () =>
      setAll(
        { count: 1, hp: 380, damage: 170, hitSpeed: 1.4, range: 8, speed: "medium" },
        { targetsAir: true },
      ),
    );
    preset("users", tr("Swarm", "حشد"), () =>
      setAll(
        { count: 5, hp: 160, damage: 80, hitSpeed: 1.0, range: 0.8, speed: "fast" },
        {},
      ),
    );
    preset("dice", tr("Surprise", "مفاجأة"), () => {
      const L = CHAMPION_LIMITS;
      const ri = (lo: number, hi: number): number => lo + Math.floor(Math.random() * (hi - lo + 1));
      for (let tries = 0; tries < 40; tries++) {
        setAll(
          {
            count: ri(1, 5),
            hp: ri(L.hp.min / 50, 3000 / 50) * 50,
            damage: ri(L.damage.min / 10, 50) * 10,
            hitSpeed: 0.9 + ri(0, 17) * 0.1,
            range: Math.random() < 0.5 ? 0.8 : ri(3, 8),
            speed: (["slow", "medium", "fast"] as const)[ri(0, 2)],
          },
          {},
        );
        for (const k of Object.keys(cur.abilities) as (keyof ChampionDef["abilities"])[]) {
          cur.abilities[k] = Math.random() < 0.22;
        }
        cur = normalizeChampion(cur);
        if (!championCostInfo(cur).overBudget) break;
      }
    });
    r.appendChild(rowEl);
  }

  slider(tr("Units", "الوحدات"), CHAMPION_LIMITS.count.min, CHAMPION_LIMITS.count.max, 1,
    () => cur.count, (v) => (cur.count = v));
  slider(tr("HP", "الصحة"), CHAMPION_LIMITS.hp.min, CHAMPION_LIMITS.hp.max, 50,
    () => cur.hp, (v) => (cur.hp = v));
  slider(tr("Damage", "الضرر"), CHAMPION_LIMITS.damage.min, CHAMPION_LIMITS.damage.max, 10,
    () => cur.damage, (v) => (cur.damage = v));
  slider(tr("Hit every", "يضرب كل"), CHAMPION_LIMITS.hitSpeed.min, CHAMPION_LIMITS.hitSpeed.max, 0.1,
    () => cur.hitSpeed, (v) => (cur.hitSpeed = v), (v) => tr(`${fmtNum(Number(v.toFixed(1)))}s`, `${fmtNum(Number(v.toFixed(1)))} ث`));

  function select<T extends string | number>(
    label: string,
    options: { value: T; text: string }[],
    get: () => T,
    set: (v: T) => void,
  ): void {
    const r = row(label);
    const sel = document.createElement("select");
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = String(o.value);
      opt.textContent = o.text;
      sel.appendChild(opt);
    }
    sel.value = String(get());
    sel.addEventListener("change", () => {
      const v = options.find((o) => String(o.value) === sel.value)!.value;
      set(v);
      refresh();
    });
    refreshers.push(() => (sel.value = String(get())));
    r.appendChild(sel);
  }

  select<number>(
    tr("Reach", "المدى"),
    [
      { value: 0.8, text: tr("Melee", "التحام") },
      ...[3, 4, 5, 6, 7, 8].map((n) => ({ value: n, text: tr(`${n} tiles`, `${n} بلاطات`) })),
    ],
    () => cur.range,
    (v) => (cur.range = v),
  );
  select<ChampionDef["speed"]>(
    tr("Speed", "السرعة"),
    [
      { value: "slow", text: tr("Slow", "بطيء") },
      { value: "medium", text: tr("Medium", "متوسط") },
      { value: "fast", text: tr("Fast", "سريع") },
    ],
    () => cur.speed,
    (v) => (cur.speed = v),
  );

  // Capabilities — each priced into the elixir cost.
  const capsHead = document.createElement("div");
  capsHead.className = "studio-section";
  capsHead.textContent = tr("Capabilities (each adds to the price)", "القدرات (كل قدرة تزيد السعر)");
  controls.appendChild(capsHead);
  const capsGrid = document.createElement("div");
  capsGrid.className = "studio-caps";
  controls.appendChild(capsGrid);
  for (const cap of Object.keys(cur.abilities) as (keyof ChampionDef["abilities"])[]) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "studio-cap v2-toggle";
    chip.innerHTML = `${icon(CAP_ICON[cap])}<span></span>`;
    chip.querySelector("span")!.textContent = capText(cap);
    chip.addEventListener("click", () => {
      if (chip.disabled) return;
      cur.abilities[cap] = !cur.abilities[cap];
      refresh();
    });
    refreshers.push(() => {
      // Pierce needs reach; flyers ignore the river on their own.
      const off = (cap === "pierce" && cur.range <= 1) || (cap === "jumpsRiver" && cur.abilities.flying);
      if (off) cur.abilities[cap] = false;
      chip.disabled = off;
      chip.setAttribute("aria-pressed", String(cur.abilities[cap]));
      chip.classList.toggle("off", off);
    });
    capsGrid.appendChild(chip);
  }

  // Appearance.
  const lookHead = document.createElement("div");
  lookHead.className = "studio-section";
  lookHead.textContent = tr("Appearance (free — style is never priced)", "المظهر (مجاني — لا يؤثر في السعر)");
  controls.appendChild(lookHead);

  function swatches(label: string, get: () => number, set: (v: number) => void): void {
    const r = row(label);
    const rowEl = document.createElement("div");
    rowEl.className = "studio-swatches";
    for (const c of CHAMPION_PALETTE) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "studio-swatch v2-swatch";
      b.style.setProperty("--swatch", `#${c.toString(16).padStart(6, "0")}`);
      b.setAttribute("aria-label", `${label} #${c.toString(16).padStart(6, "0")}`);
      b.addEventListener("click", (e) => {
        e.preventDefault();
        set(c);
        refresh();
      });
      refreshers.push(() => {
        b.classList.toggle("sel", get() === c);
        b.setAttribute("aria-pressed", String(get() === c));
      });
      rowEl.appendChild(b);
    }
    r.appendChild(rowEl);
  }
  swatches(tr("Outfit", "الزي"), () => cur.look.body, (v) => (cur.look.body = v));
  swatches(tr("Trim", "الزخرفة"), () => cur.look.trim, (v) => (cur.look.trim = v));

  select<ChampionDef["look"]["headgear"]>(
    tr("Headgear", "غطاء الرأس"),
    [
      { value: "helmet", text: tr("Helmet", "خوذة") },
      { value: "hood", text: tr("Hood", "قلنسوة") },
      { value: "crown", text: tr("Crown", "تاج") },
      { value: "horns", text: tr("Horns", "قرون") },
      { value: "turban", text: tr("Turban", "عمامة") },
      { value: "none", text: tr("None", "بدون") },
    ],
    () => cur.look.headgear,
    (v) => (cur.look.headgear = v),
  );
  select<ChampionDef["look"]["weapon"]>(
    tr("Weapon", "السلاح"),
    [
      { value: "sword", text: tr("Sword", "سيف") },
      { value: "axe", text: tr("Axe", "فأس") },
      { value: "hammer", text: tr("Hammer", "مطرقة") },
      { value: "spear", text: tr("Spear", "رمح") },
      { value: "bow", text: tr("Bow", "قوس") },
      { value: "staff", text: tr("Staff", "عصا") },
      { value: "none", text: tr("Fists", "قبضات") },
    ],
    () => cur.look.weapon,
    (v) => (cur.look.weapon = v),
  );
  select<ChampionDef["look"]["mood"]>(
    tr("Face", "الوجه"),
    [
      { value: "brave", text: tr("Brave", "شجاع") },
      { value: "angry", text: tr("Angry", "غاضب") },
      { value: "cute", text: tr("Cute", "لطيف") },
      { value: "wicked", text: tr("Wicked", "شرير") },
      { value: "calm", text: tr("Calm", "هادئ") },
    ],
    () => cur.look.mood,
    (v) => (cur.look.mood = v),
  );

  {
    const r = row(tr("Preview", "المعاينة"));
    const b = document.createElement("button");
    b.type = "button";
    b.className = "studio-walk v2-chipbtn";
    const paint = (): void => {
      b.innerHTML = `${icon(walking ? "pause" : "play")}<span></span>`;
      b.querySelector("span")!.textContent = walking ? tr("Walking", "يمشي") : tr("Standing", "واقف");
    };
    paint();
    b.addEventListener("click", (e) => {
      e.preventDefault();
      walking = !walking;
      paint();
    });
    r.appendChild(b);
  }

  // Delete the (single) champion after a confirm: it leaves the save,
  // the collection and the deck.
  if (hasSavedChampion()) {
    const delBtn = button({
      variant: "ghost",
      icon: "trash",
      label: tr("Delete champion", "احذف البطل"),
      onClick: async () => {
        const ok = await ask({
          title: tr("Delete your champion?", "حذف بطلك؟"),
          body: tr("It leaves your collection and your deck. This cannot be undone.", "سيُزال من مجموعتك ومن سطحك. لا يمكن التراجع."),
          okLabel: tr("Delete", "احذف"),
          cancelLabel: tr("Keep it", "أبقِه"),
          danger: true,
        });
        if (!ok) return;
        deleteChampion();
        invalidatePortrait("champion");
        const owned = meta.profile.owned.filter((id) => id !== "champion");
        meta.playerDeck = clampDeckToOwned(
          meta.playerDeck.filter((id) => id !== "champion"),
          ownedSet(owned),
        );
        meta.profile = { ...meta.profile, owned, deck: meta.playerDeck };
        ctx.persistProfile();
        closeStudio();
        ctx.openHome();
      },
    });
    delBtn.classList.add("studio-delete");
    pickerRoot.appendChild(delBtn);
  }

  refresh();
}

const CAP_ICON: Record<keyof ChampionDef["abilities"], IconName> = {
  flying: "wing",
  targetsAir: "target",
  splash: "burst",
  charge: "bolt",
  stun: "sparkle",
  chill: "snow",
  pierce: "arrow",
  jumpsRiver: "wave",
  deathBomb: "bomb",
  buildingsOnly: "tower",
  summoner: "skull",
};

function capText(cap: keyof ChampionDef["abilities"]): string {
  const labels: Record<keyof ChampionDef["abilities"], [string, string]> = {
    flying: ["Flies", "يطير"],
    targetsAir: ["Hits air", "يضرب الجو"],
    splash: ["Splash", "ضرر منطقة"],
    charge: ["Charge (2x)", "شحنة (×2)"],
    stun: ["Stunning hits", "ضربات صاعقة"],
    chill: ["Chilling hits", "ضربات مجمّدة"],
    pierce: ["Piercing shots", "سهام خارقة"],
    jumpsRiver: ["River jump", "قفز النهر"],
    deathBomb: ["Death bomb", "قنبلة موت"],
    buildingsOnly: ["Building hunter (cheaper!)", "صائد المباني (أرخص!)"],
    summoner: ["Summons skeletons", "يستدعي الميليشيا"],
  };
  return tr(labels[cap][0], labels[cap][1]);
}
