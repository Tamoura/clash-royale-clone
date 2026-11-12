// Render perf budget: boots the game, starts a bot battle and reports one
// frame's renderer counters, first for the empty battle and then for a fixed
// 12-card fight (6 per side), as JSON:
//
//   node tools/perf-budget.mjs [--url http://127.0.0.1:3101] [--edition arabic]
//                              [--arena <id>] [--view WxH[@dpr]] [--chrome <path>]
//                              [--max-calls N] [--max-empty-calls N]
//                              [--max-triangles N] [--max-empty-triangles N]
//                              [--max-textures N]
//   node tools/perf-budget.mjs --matrix [--url ...] [--arena <id>] [gate flags] [--zone]
//   npm run perf:budget            (the --matrix run on its own dev server)
//
// --zone (report only, never a gate) also reads the empty battle with the
// placement map up (setZoneVisible(true) for a troop, as holding a Knight
// does) and reports emptyZone and its delta against the empty frame.
//
// {"edition":..,"view":..,"cast":..,"empty":{calls,triangles,geometries,textures},"fight":{...}}
//
// --matrix measures both editions (Classic and Golden Age) at 390x844@2 and
// 1440x900@1 in one browser and prints one table (Markdown) after the JSON
// lines. The page runs at ?quality=high (L0, the most expensive level).
//
// Enforced gates (exit code 2 when any run exceeds one; art bible 11 and the
// art-direction shared rules 6). Pass "off" to a flag to switch that check off:
//   12-card fight   --max-calls 450   --max-triangles 850000   --max-textures 110
//   empty battle    --max-empty-calls 220   --max-empty-triangles 300000
// Targets (reported, not enforced): fight 400 calls / 750k triangles, empty
// 200 calls / 260k triangles.
//
// The bot is starved of elixir and the fight is read after 3 s of SIM time, so
// runs line up; ambient FX (dust, sparks, birds) still wobble a few calls.
// Every composer pass counts (bloom alone is ~10 full-screen draws), which is
// why renderer.info.autoReset is switched off and reset once per frame here.
// Triangles include the shadow pass (troop casters re-render it every frame
// on the top level). SwiftShader timings mean nothing: gate on the counters.
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const MATRIX = args.includes("--matrix");
const ZONE = args.includes("--zone");
const ARENA = opt("arena", null);
const limit = (name, fallback) => {
  const v = opt(name, String(fallback));
  return v === "off" ? null : Number(v);
};
const GATES = {
  fightCalls: limit("max-calls", 450),
  emptyCalls: limit("max-empty-calls", 220),
  fightTriangles: limit("max-triangles", 850_000),
  emptyTriangles: limit("max-empty-triangles", 300_000),
  fightTextures: limit("max-textures", 110),
};
const TARGETS = { fightCalls: 400, emptyCalls: 200, fightTriangles: 750_000, emptyTriangles: 260_000 };
const CHROME = opt("chrome", process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium");
const parseView = (v) => {
  const [, w = "390", h = "844", d = "2"] = /^(\d+)x(\d+)(?:@([\d.]+))?$/.exec(v ?? "") ?? [];
  return { width: Number(w), height: Number(h), deviceScaleFactor: Number(d) };
};
const viewName = (v) => `${v.width}x${v.height}@${v.deviceScaleFactor}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The same 12 cards every run, spread over both lanes so they meet mid-field.
const PLAYER = [
  ["knight", 4, 21], ["giant", 14, 21], ["musketeer", 6, 25],
  ["wizard", 12, 25], ["mini-pekka", 3, 19], ["archers", 15, 24],
];
const ENEMY = [
  ["valkyrie", 4, 11], ["pekka", 14, 11], ["archers", 6, 7],
  ["baby-dragon", 12, 7], ["hog-rider", 3, 12], ["witch", 15, 8],
];

const runs = MATRIX
  ? ["normal", "arabic"].flatMap((edition) => ["390x844@2", "1440x900@1"].map((v) => ({ edition, view: parseView(v) })))
  : [{ edition: opt("edition", "clash") === "arabic" ? "arabic" : "normal", view: parseView(opt("view", "")) }];

let server = null;
let base = opt("url", null);
if (!base) {
  const { createServer } = await import("vite");
  server = await createServer({
    root: resolve(import.meta.dirname, ".."),
    server: { port: 3198, strictPort: false },
    logLevel: "error",
  });
  await server.listen();
  base = server.resolvedUrls.local[0];
}
base = base.replace(/\/$/, "");

/** One measured battle in a fresh browser context (no shared storage). */
async function measure(browser, { edition, view }, errors) {
  const ctx = await browser.createBrowserContext();
  try {
    const page = await ctx.newPage();
    await page.setViewport(view);
    await page.evaluateOnNewDocument((ed) => {
      localStorage.setItem("cr-clone-arena-theme", ed);
      localStorage.setItem("cr-clone-tutored", "1");
      localStorage.setItem("cr-clone-newcards-seen", "1");
    }, edition);
    page.on("pageerror", (e) => errors.push(`${edition} ${viewName(view)}: ${e.message}`));
    // The battle-start gate (main.ts) latches the cast for the whole battle,
    // so start only once the pack is in (DEV logs "cast: pack ready") or has
    // failed; a slow software-GL boot would otherwise measure the procedural
    // roster. `cast` in the output says which roster was measured.
    let castState = null;
    const castSettled = new Promise((done) => {
      page.on("console", (m) => {
        const text = m.text();
        if (text.startsWith("cast: pack ready")) done((castState = "cast"));
        else if (text.startsWith("cast: pack failed")) done((castState = "procedural"));
      });
    });
    await page.goto(`${base}/?quality=high${ARENA ? `&arena=${ARENA}` : ""}`, { waitUntil: "load", timeout: 120000 });
    await page.waitForFunction(() => window.__cr, { timeout: 120000 });
    await Promise.race([castSettled, wait(45000)]);
    await wait(1500);
    await page.evaluate(() => document.querySelector(".home-battle")?.click());
    await wait(600);
    await page.evaluate(() =>
      document.querySelector('button[aria-label="Start a battle against the bot"]')?.click(),
    );
    await page.waitForFunction(() => window.__cr.phase() === "playing", { timeout: 120000 });

    // One frame = everything between two Battle3D.render() calls, so wrap the
    // instance's render and snapshot the counters it leaves behind.
    await page.evaluate(() => {
      const cr = window.__cr;
      const scene = cr.scene();
      const renderer = cr.renderer ?? scene.renderer;
      renderer.info.autoReset = false;
      const render = scene.render.bind(scene);
      scene.render = (dt) => {
        renderer.info.reset();
        render(dt);
        const { render: r, memory: m } = renderer.info;
        window.__perfFrame = { calls: r.calls, triangles: r.triangles, geometries: m.geometries, textures: m.textures };
      };
      // Keep the bot from deploying so every run draws the same field.
      const starve = () => {
        const b = cr.battle();
        if (b?.enemy) b.enemy.elixir = { amount: 0 };
        requestAnimationFrame(starve);
      };
      starve();
    });
    const frame = async () => {
      await page.evaluate(() => (window.__perfFrame = null));
      await page.waitForFunction(() => window.__perfFrame, { timeout: 60000 });
      return page.evaluate(() => window.__perfFrame);
    };

    await wait(1500);
    const empty = await frame();
    let emptyZone = null;
    if (ZONE) {
      // The placement map for a held troop: one plane (scene/deployOverlay.ts).
      await page.evaluate(() => window.__cr.scene().setZoneVisible(true, { kind: "troop" }));
      for (let i = 0; i < 3; i++) await frame(); // past its 0.12 s fade-in
      const z = await frame();
      emptyZone = { calls: z.calls, triangles: z.triangles, delta: { calls: z.calls - empty.calls, triangles: z.triangles - empty.triangles } };
      await page.evaluate(() => window.__cr.scene().setZoneVisible(false));
      for (let i = 0; i < 2; i++) await frame();
    }

    await page.evaluate(
      (player, enemy) => {
        for (const [id, x, y] of player) window.__cr.spawn("player", id, x, y);
        for (const [id, x, y] of enemy) window.__cr.spawn("enemy", id, x, y);
        window.__perfT0 = window.__cr.battle().time;
      },
      PLAYER,
      ENEMY,
    );
    await page.waitForFunction(() => window.__cr.battle().time >= window.__perfT0 + 3, {
      timeout: 180000,
      polling: 50,
    });
    const fight = await frame();
    return { edition, view: viewName(view), cast: castState ?? "timeout", empty, ...(emptyZone ? { emptyZone } : {}), fight };
  } finally {
    await ctx.close();
  }
}

/** Gate failures for one run's counters. */
function overBudget(r) {
  const out = [];
  const check = (gate, value, what) => {
    if (gate !== null && value > gate) out.push(`${r.edition} ${r.view}: ${what} ${value.toLocaleString("en")} is over its gate of ${gate.toLocaleString("en")}`);
  };
  check(GATES.emptyCalls, r.empty.calls, "empty battle draw calls");
  check(GATES.emptyTriangles, r.empty.triangles, "empty battle triangles");
  check(GATES.fightCalls, r.fight.calls, "12-card fight draw calls");
  check(GATES.fightTriangles, r.fight.triangles, "12-card fight triangles");
  check(GATES.fightTextures, r.fight.textures, "12-card fight textures");
  return out;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox", "--mute-audio"],
  protocolTimeout: 600000,
});
const errors = [];
const results = [];
try {
  for (const run of runs) {
    const r = await measure(browser, run, errors);
    results.push(r);
    console.log(JSON.stringify(r));
  }
} finally {
  await browser.close();
  await server?.close();
}

if (MATRIX) {
  const fmt = (n) => n.toLocaleString("en");
  const mark = (v, target) => (v > target ? `${fmt(v)} (over target)` : fmt(v));
  const lines = [
    "",
    `| View | Edition | Roster | Empty calls | Empty tris | Fight calls | Fight tris | Fight textures |`,
    `|---|---|---|---|---|---|---|---|`,
    ...results.map(
      (r) =>
        `| ${r.view} | ${r.edition === "arabic" ? "Golden Age" : "Classic"} | ${r.cast} | ${mark(r.empty.calls, TARGETS.emptyCalls)} | ${mark(r.empty.triangles, TARGETS.emptyTriangles)} | ${mark(r.fight.calls, TARGETS.fightCalls)} | ${mark(r.fight.triangles, TARGETS.fightTriangles)} | ${r.fight.textures} |`,
    ),
    "",
    ...(ZONE
      ? [
          "",
          "Placement map held (report only): " +
            results.map((r) => `${r.view} ${r.edition === "arabic" ? "Golden Age" : "Classic"} ${r.emptyZone.delta.calls >= 0 ? "+" : ""}${r.emptyZone.delta.calls} calls, ${r.emptyZone.delta.triangles >= 0 ? "+" : ""}${fmt(r.emptyZone.delta.triangles)} tris`).join("; "),
        ]
      : []),
    "",
    `Gates: empty ${GATES.emptyCalls ?? "off"} calls / ${GATES.emptyTriangles === null ? "off" : fmt(GATES.emptyTriangles)} tris; fight ${GATES.fightCalls ?? "off"} calls / ${GATES.fightTriangles === null ? "off" : fmt(GATES.fightTriangles)} tris / ${GATES.fightTextures ?? "off"} textures. Targets: empty ${TARGETS.emptyCalls} / ${fmt(TARGETS.emptyTriangles)}, fight ${TARGETS.fightCalls} / ${fmt(TARGETS.fightTriangles)}.`,
  ];
  console.log(lines.join("\n"));
}
if (errors.length) {
  console.error("page errors:\n  " + errors.join("\n  "));
  process.exit(1);
}
const over = results.flatMap(overBudget);
if (over.length) {
  console.error(over.join("\n"));
  process.exit(2);
}
console.error(`perf-budget: ${results.length} run(s) within every gate`);
