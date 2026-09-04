const puppeteer = require("puppeteer-core");
const OUT = "/tmp/claude-0/-home-user-clash-royale-clone/66a59f48-236a-5b22-882b-e5121637246b/scratchpad/arenas";
const fs = require("fs");
fs.mkdirSync(OUT, { recursive: true });

// arena id + sky phase pairs to capture.
const SHOTS = [
  ["training-camp", 0], ["goblin-stadium", 0], ["bone-pit", 0], ["barbarian-bowl", 0],
  ["pekka-playhouse", 0], ["spell-valley", 0], ["builders-workshop", 0], ["royal-arena", 0],
  ["frozen-peak", 0], ["jungle-arena", 0], ["legendary-peak", 0],
  ["training-camp", 0.5], ["training-camp", 1], ["royal-arena", 1],
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/opt/pw-browsers/chromium",
    args: ["--enable-unsafe-swiftshader", "--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("cr-clone-arena-theme", "normal");
    localStorage.setItem("cr-clone-tutored", "1");
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const [arena, sky] of SHOTS) {
    await page.goto(`http://localhost:3101/?arena=${arena}&sky=${sky}`, { waitUntil: "load", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.waitForSelector(".battle-btn", { timeout: 20000 });
    await page.click(".battle-btn");
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(() => {
      document.querySelector("#deckpicker .battle-btn:not(.friend), .battle-btn:not(.friend)").click();
    });
    await new Promise((r) => setTimeout(r, 4500));
    await page.screenshot({ path: `${OUT}/${arena}--${sky}.png`, clip: { x: 0, y: 95, width: 360, height: 520 } });
    console.log("shot:", arena, sky);
  }
  console.log("pageerrors:", errors.length ? errors : "none");
  await browser.close();
})();
