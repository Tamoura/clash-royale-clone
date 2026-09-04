const puppeteer = require("puppeteer-core");
const OUT = "/tmp/claude-0/-home-user-clash-royale-clone/66a59f48-236a-5b22-882b-e5121637246b/scratchpad";
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/opt/pw-browsers/chromium",
    args: ["--enable-unsafe-swiftshader", "--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 520, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => localStorage.setItem("cr-clone-arena-theme", "normal"));
  page.on("pageerror", (e) => { if (!String(e).includes("gallery mode")) console.log("pageerror:", String(e)); });
  for (const id of ["tower-princess", "tower-cannoneer", "tower-duchess"]) {
    await page.goto(`http://localhost:3101/?gallery=${id}`, { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector("canvas", { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: `${OUT}/${id}.png` });
    console.log("shot:", id);
  }
  await browser.close();
})();
