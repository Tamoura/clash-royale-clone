// Quick visual smoke-check: boot the game, start a bot battle, deploy a few
// troops, and save PNG frames of the live canvas. (Dev aid, not shipped.)
const puppeteer = require("puppeteer-core");
const fs = require("fs");

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/opt/pw-browsers/chromium",
    headless: "new",
    args: ["--enable-unsafe-swiftshader", "--no-sandbox", "--window-size=900,760", "--mute-audio"],
    defaultViewport: { width: 900, height: 760 },
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("cr-clone-arena-theme", "normal");
    localStorage.setItem("cr-clone-difficulty", "hard");
  });
  await page.goto("http://localhost:3101", { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 4000)); // vite transform + boot
  await page.waitForSelector(".battle-btn", { timeout: 20000 });
  await page.click(".battle-btn"); // lobby "Battle" -> deck picker
  await new Promise((r) => setTimeout(r, 600));
  await page.click(".battle-btn"); // deck picker "Battle the Bot"
  await new Promise((r) => setTimeout(r, 4500)); // countdown

  const deploy = async (key, x, y) => {
    await page.keyboard.press(key);
    await page.mouse.click(x, y);
  };
  await deploy("1", 330, 420);
  await deploy("2", 560, 430);
  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: "/tmp/shot-early.png" });
  await deploy("3", 330, 470);
  await deploy("4", 560, 470);
  await new Promise((r) => setTimeout(r, 8000));
  await page.screenshot({ path: "/tmp/shot-mid.png" });
  await new Promise((r) => setTimeout(r, 15000));
  await page.screenshot({ path: "/tmp/shot-late.png" });
  await browser.close();
  for (const f of ["shot-early", "shot-mid", "shot-late"]) {
    console.log(f, fs.statSync(`/tmp/${f}.png`).size, "bytes");
  }
})();
