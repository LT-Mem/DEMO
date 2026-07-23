import { chromium } from "playwright";

const targets = [
  ["local", "http://127.0.0.1:8080/"],
  ["public", "https://lt-mem.github.io/DEMO/interactive/"],
];

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
});

let failed = false;
for (const [name, url] of targets) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("console", (message) => console.log(name, "CONSOLE", message.type(), message.text()));
  page.on("pageerror", (error) => console.log(name, "PAGEERROR", error.stack || error.message));
  page.on("requestfailed", (request) => console.log(name, "REQUEST_FAILED", request.url(), request.failure()?.errorText));
  page.on("response", (response) => {
    if (response.status() >= 400) console.log(name, "HTTP", response.status(), response.url());
  });

  console.log(name, "OPEN", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  try {
    await page.waitForFunction(() => document.querySelector("#loader")?.classList.contains("hidden"), null, { timeout: 30000 });
    await page.waitForSelector("#viewer canvas", { timeout: 5000 });
  } catch {
    failed = true;
  }

  let dragChanged = false;
  const canvas = page.locator("#viewer canvas");
  if (await canvas.count()) {
    const box = await canvas.boundingBox();
    const before = await canvas.screenshot();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.58, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after = await canvas.screenshot();
    dragChanged = !before.equals(after);
    if (!dragChanged) failed = true;
  }

  const state = await page.evaluate(() => ({
    loaderClass: document.querySelector("#loader")?.className,
    stats: document.querySelector("#cloudStats")?.textContent,
    scene: document.querySelector("#sceneModeLabel")?.textContent,
    canvas: document.querySelectorAll("#viewer canvas").length,
    staticMaps: document.querySelectorAll(".static-map").length,
  }));
  console.log(name, "FINAL_STATE", JSON.stringify({ ...state, dragChanged }));
  await page.screenshot({ path: name + ".png", fullPage: true });
  await page.close();
}
await browser.close();
if (failed) process.exit(1);
