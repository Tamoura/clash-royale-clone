const puppeteer = require("puppeteer-core");
const fs = require("fs");

(async () => {
  const browser = await puppeteer.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: "new",
    args: ["--enable-unsafe-swiftshader", "--window-size=900,760", "--mute-audio"],
    defaultViewport: { width: 900, height: 760 },
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("cr-clone-difficulty", "hard");
  });
  await page.goto("http://localhost:3101", { waitUntil: "networkidle0" });
  await page.click(".battle-btn"); // start with the saved/default deck
  await new Promise((r) => setTimeout(r, 5000)); // countdown

  // Fight back so there's melee on screen: key-select then place.
  const deploy = async (key, x, y) => {
    await page.keyboard.press(key);
    await page.mouse.click(x, y);
  };
  // Early aggression near the bridge approach on our half.
  await deploy("1", 330, 420); // knight, left lane
  await new Promise((r) => setTimeout(r, 4000));
  await deploy("2", 560, 430); // archers, right lane
  await new Promise((r) => setTimeout(r, 5000));

  // Record 9 seconds of the live canvas.
  const b64 = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const canvas = document.querySelector("#stage canvas");
        const stream = canvas.captureStream(30);
        const rec = new MediaRecorder(stream, {
          mimeType: "video/webm;codecs=vp8",
          videoBitsPerSecond: 6_000_000,
        });
        const chunks = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        rec.onstop = async () => {
          const blob = new Blob(chunks, { type: "video/webm" });
          const buf = await blob.arrayBuffer();
          let s = "";
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.length; i += 0x8000) {
            s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          }
          resolve(btoa(s));
        };
        rec.start();
        setTimeout(() => rec.stop(), 9000);
      }),
  );
  fs.writeFileSync("/tmp/cr-battle.webm", Buffer.from(b64, "base64"));
  await browser.close();
  console.log("saved", fs.statSync("/tmp/cr-battle.webm").size, "bytes");
})();
