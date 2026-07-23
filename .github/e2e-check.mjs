import { chromium } from "playwright";

const targets = [
  ["local", "http://127.0.0.1:8080/viewer/"],
  ["public", "https://lt-mem.github.io/DEMO/viewer/"],
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
    await page.waitForFunction(() => document.querySelector("#loader")?.classList.contains("hidden"), null, { timeout: 150000 });
  } catch {
    failed = true;
  }
  const state = await page.evaluate(() => ({
    loader: document.querySelector("#loader")?.innerText,
    loaderClass: document.querySelector("#loader")?.className,
    stats: document.querySelector("#cloudStats")?.textContent,
    scene: document.querySelector("#sceneModeLabel")?.textContent,
    canvas: document.querySelectorAll("canvas").length,
  }));
  console.log(name, "FINAL_STATE", JSON.stringify(state));
  await page.screenshot({ path: name + ".png", fullPage: true });
  await page.close();
}
await browser.close();
if (failed) process.exit(1);
