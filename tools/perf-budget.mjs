// Render perf budget: boots the game, starts a bot battle and reports one
// frame's renderer counters, first for the empty battle and then for a fixed
// 12-card fight (6 per side), as JSON:
//
//   node tools/perf-budget.mjs [--url http://127.0.0.1:3101] [--edition arabic]
//                              [--arena <id>] [--max-calls N] [--max-empty-calls N]
//                              [--chrome <path>]
//
// {"empty":{calls,triangles,geometries,textures},"fight":{...}}
// Enforced budgets (exit code 2 when exceeded): the 12-card fight may draw
// --max-calls calls (default 450) and the empty battle --max-empty-calls
// (default 220). Pass "off" to a flag to switch that check off.
//
// The bot is starved of elixir and the fight is read after 3 s of SIM time, so
// runs line up; ambient FX (dust, sparks, birds) still wobble a few calls.
// Numbers (390x844 @2, ?quality=high, first arena, software GL):
//   before rig baking   classic empty 246 / fight 1,165   arabic 259 / 1,260
//   after               see the package notes; the budgets above are the gate
// (The audits measured ~465 empty and ~1,568 in a looser, bot-fed fight.)
// Every composer pass counts (bloom alone is ~10 full-screen draws), which is
// why renderer.info.autoReset is switched off and reset once per frame here.
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const EDITION = opt("edition", "clash") === "arabic" ? "arabic" : "normal";
const ARENA = opt("arena", null);
const limit = (name, fallback) => {
  const v = opt(name, String(fallback));
  return v === "off" ? null : Number(v);
};
const MAX_FIGHT_CALLS = limit("max-calls", 450);
const MAX_EMPTY_CALLS = limit("max-empty-calls", 220);
const CHROME = opt("chrome", process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium");
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

const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox", "--mute-audio"],
});
const errors = [];
let result = null;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((edition) => {
    localStorage.setItem("cr-clone-arena-theme", edition);
    localStorage.setItem("cr-clone-tutored", "1");
  }, EDITION);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?quality=high${ARENA ? `&arena=${ARENA}` : ""}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__cr, { timeout: 60000 });
  await wait(1500);
  await page.evaluate(() => document.querySelector(".home-battle")?.click());
  await wait(600);
  await page.evaluate(() =>
    document.querySelector('button[aria-label="Start a battle against the bot"]')?.click(),
  );
  await page.waitForFunction(() => window.__cr.phase() === "playing", { timeout: 60000 });

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
    await page.waitForFunction(() => window.__perfFrame, { timeout: 30000 });
    return page.evaluate(() => window.__perfFrame);
  };

  await wait(1500);
  const empty = await frame();

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
    timeout: 120000,
    polling: 50,
  });
  const fight = await frame();
  result = { edition: EDITION, empty, fight };
} finally {
  await browser.close();
  await server?.close();
}

console.log(JSON.stringify(result));
if (errors.length) {
  console.error("page errors:\n  " + errors.join("\n  "));
  process.exit(1);
}
const over = [];
if (MAX_EMPTY_CALLS !== null && result.empty.calls > MAX_EMPTY_CALLS) {
  over.push(`empty battle draws ${result.empty.calls} calls, over its budget of ${MAX_EMPTY_CALLS}`);
}
if (MAX_FIGHT_CALLS !== null && result.fight.calls > MAX_FIGHT_CALLS) {
  over.push(`12-card fight draws ${result.fight.calls} calls, over its budget of ${MAX_FIGHT_CALLS}`);
}
if (over.length) {
  console.error(over.join("\n"));
  process.exit(2);
}
