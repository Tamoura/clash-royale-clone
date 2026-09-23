// Visual regression sheet: boots the game on a Vite dev server, captures
// the home screen, every trophy-road arena mid-battle (with a fixed troop
// line-up), and the night sky, then tiles them into one contact sheet.
//
//   npm run visual-sheet                      -> visual-sheet/<name>.png + sheet.png
//   npm run visual-sheet -- --out shots/new --baseline shots/old
//                                             -> also prints % of pixels changed
//                                                per shot and writes diff-sheet.png
//
// Options: --out <dir>  --baseline <dir>  --url <running dev server>
//          --only <arena id,...>  --chrome <path>  (or CHROME_PATH)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const OUT = resolve(opt("out", "visual-sheet"));
const BASELINE = opt("baseline", null);
const ONLY = opt("only", null)?.split(",");
const CHROME = opt("chrome", process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium");
const VIEW = { width: 390, height: 844, deviceScaleFactor: 1 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Same line-up every run so shots are comparable.
const PLAYER = [["knight", 4, 21], ["giant", 14, 21], ["musketeer", 6, 25], ["wizard", 12, 25]];
const ENEMY = [["valkyrie", 4, 11], ["pekka", 14, 11], ["archers", 6, 7], ["baby-dragon", 12, 7]];

let server = null;
let base = opt("url", null);
if (!base) {
  const { createServer } = await import("vite");
  server = await createServer({ server: { port: 3199, strictPort: false }, logLevel: "error" });
  await server.listen();
  base = server.resolvedUrls.local[0].replace(/\/$/, "");
}
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox", "--mute-audio"],
});
const errors = [];

async function openPage(query) {
  const page = await browser.newPage();
  await page.setViewport(VIEW);
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("cr-clone-arena-theme", "normal");
    localStorage.setItem("cr-clone-tutored", "1");
  });
  page.on("pageerror", (e) => errors.push(`${query}: ${e.message}`));
  await page.goto(`${base}/?quality=high${query}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__cr, { timeout: 30000 });
  await wait(2500);
  return page;
}

async function startBattle(page) {
  await page.evaluate(() => document.querySelector(".home-battle")?.click());
  await wait(600);
  await page.evaluate(() =>
    document.querySelector('button[aria-label="Start a battle against the bot"]')?.click(),
  );
  await page.waitForFunction(() => window.__cr.phase() === "playing", { timeout: 30000 });
  await page.evaluate(
    (player, enemy) => {
      for (const [id, x, y] of player) window.__cr.spawn("player", id, x, y);
      for (const [id, x, y] of enemy) window.__cr.spawn("enemy", id, x, y);
    },
    PLAYER,
    ENEMY,
  );
  await wait(1200);
}

const shots = [];
async function capture(name, query, battle) {
  const page = await openPage(query);
  if (battle) await startBattle(page);
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(name);
  console.log(`  ${name}`);
  await page.close();
}

console.log(`capturing to ${OUT}`);
await capture("home", "", false);
const probe = await openPage("");
const arenas = (await probe.evaluate(() => window.__cr.arenas())).filter((id) => !ONLY || ONLY.includes(id));
await probe.close();
for (const id of arenas) await capture(`arena-${id}`, `&arena=${id}`, true);
await capture("night-sky", `&arena=${arenas[0]}&sky=1`, true);

// Tile (and optionally diff) in the browser: no image libraries needed.
const dataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;
const page = await browser.newPage();
const result = await page.evaluate(
  async (items, W, H) => {
    const load = (src) =>
      new Promise((res) => {
        if (!src) return res(null);
        const img = new Image();
        img.onload = () => res(img);
        img.src = src;
      });
    const cols = Math.min(4, items.length);
    const rows = Math.ceil(items.length / cols);
    const scale = 0.5;
    const cw = W * scale;
    const ch = H * scale + 22;
    const sheet = document.createElement("canvas");
    sheet.width = cols * cw;
    sheet.height = rows * ch;
    const sctx = sheet.getContext("2d");
    sctx.fillStyle = "#15182a";
    sctx.fillRect(0, 0, sheet.width, sheet.height);
    const diffSheet = document.createElement("canvas");
    diffSheet.width = sheet.width;
    diffSheet.height = sheet.height;
    const dctx = diffSheet.getContext("2d");
    dctx.fillStyle = "#15182a";
    dctx.fillRect(0, 0, sheet.width, sheet.height);
    const diffs = {};
    for (let i = 0; i < items.length; i++) {
      const { name, cur, old } = items[i];
      const x = (i % cols) * cw;
      const y = Math.floor(i / cols) * ch;
      const a = await load(cur);
      sctx.drawImage(a, x, y + 22, cw, ch - 22);
      sctx.fillStyle = "#fff";
      sctx.font = "bold 14px sans-serif";
      sctx.fillText(name, x + 6, y + 16);
      const b = await load(old);
      if (!b) continue;
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const ctx = c.getContext("2d");
      ctx.drawImage(a, 0, 0, W, H);
      const pa = ctx.getImageData(0, 0, W, H).data;
      ctx.drawImage(b, 0, 0, W, H);
      const pb = ctx.getImageData(0, 0, W, H).data;
      const out = ctx.createImageData(W, H);
      let changed = 0;
      for (let p = 0; p < pa.length; p += 4) {
        const d = Math.abs(pa[p] - pb[p]) + Math.abs(pa[p + 1] - pb[p + 1]) + Math.abs(pa[p + 2] - pb[p + 2]);
        const hit = d > 48;
        if (hit) changed++;
        out.data[p] = hit ? 255 : pa[p] * 0.25;
        out.data[p + 1] = hit ? 40 : pa[p + 1] * 0.25;
        out.data[p + 2] = hit ? 90 : pa[p + 2] * 0.25;
        out.data[p + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      dctx.drawImage(c, x, y + 22, cw, ch - 22);
      dctx.fillStyle = "#fff";
      dctx.font = "bold 14px sans-serif";
      const pct = (100 * changed) / (W * H);
      dctx.fillText(`${name}  ${pct.toFixed(1)}%`, x + 6, y + 16);
      diffs[name] = pct;
    }
    return {
      sheet: sheet.toDataURL("image/png"),
      diffSheet: Object.keys(diffs).length ? diffSheet.toDataURL("image/png") : null,
      diffs,
    };
  },
  shots.map((name) => {
    const old = BASELINE ? join(resolve(BASELINE), `${name}.png`) : null;
    return {
      name,
      cur: dataUrl(join(OUT, `${name}.png`)),
      old: old && existsSync(old) ? dataUrl(old) : null,
    };
  }),
  VIEW.width,
  VIEW.height,
);
const save = (file, url) => writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));
save(join(OUT, "sheet.png"), result.sheet);
console.log(`sheet: ${join(OUT, "sheet.png")}`);
if (result.diffSheet) {
  save(join(OUT, "diff-sheet.png"), result.diffSheet);
  console.log("pixels changed vs baseline (animated scenes are never 0%):");
  for (const [name, pct] of Object.entries(result.diffs)) console.log(`  ${name.padEnd(22)} ${pct.toFixed(1)}%`);
  console.log(`diff sheet: ${join(OUT, "diff-sheet.png")}`);
}

await browser.close();
await server?.close();
if (errors.length) {
  console.error("page errors:\n  " + errors.join("\n  "));
  process.exit(1);
}
