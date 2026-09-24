import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir("../docs/screenshots/v2", { recursive: true });
await page.goto("http://127.0.0.1:8766/");
await page.getByLabel("场景提示词").waitFor();
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: "../docs/screenshots/v2/create-first.png" });
console.log(
  JSON.stringify({
    title: await page.title(),
    errors,
    layout: await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      bodyHeight: document.body.scrollHeight,
      bodyWidth: document.body.scrollWidth,
      areas: [
        ...document.querySelectorAll(
          ".workspace-frame,.editor-canvas,.workbench-inspector,.generation-command-bar",
        ),
      ].map((e) => ({
        name: e.className,
        height: e.clientHeight,
        scroll: e.scrollHeight,
        box: e.getBoundingClientRect().toJSON(),
      })),
    })),
  }),
);
await page.goto("http://127.0.0.1:8766/settings");
await page.getByRole("heading", { name: "设置", exact: true }).waitFor();
await page.screenshot({ path: "../docs/screenshots/v2/settings-first.png" });
await page.goto("http://127.0.0.1:8766/library");
await page.getByRole("heading", { name: "作品库", exact: true }).waitFor();
await page.screenshot({ path: "../docs/screenshots/v2/library-first.png" });
await browser.close();
