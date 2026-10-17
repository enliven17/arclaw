/** How it works frames: desktop wheel-scrubs through the pin, mobile plays once. node scripts/how-frames.mjs <w> <h> [--mobile] */
import { chromium } from "playwright-core";
const [w, h] = process.argv.slice(2, 4).map(Number);
const mobile = process.argv.includes("--mobile");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
await ctx.addInitScript(() => sessionStorage.setItem("arclaw:splash", "1"));
const p = await ctx.newPage();
await p.goto("http://localhost:3210", { waitUntil: "networkidle" });
await p.waitForTimeout(2000);
const stage = p.locator("#how [data-stage]");
const out = [];
if (!mobile) {
  await p.mouse.move(w / 2, h / 2);
  const top = await p.evaluate(() => document.querySelector("#how").parentElement.getBoundingClientRect().top + scrollY);
  while ((await p.evaluate(() => scrollY)) < top - 40) { await p.mouse.wheel(0, 200); await p.waitForTimeout(30); }
  for (let i = 0; i < 12; i++) {
    for (let k = 0; k < 2; k++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(40); }
    await p.waitForTimeout(700);
    const f = `shots/how-${w}-f${String(i).padStart(2, "0")}.png`;
    await stage.screenshot({ path: f });
    out.push(f);
  }
} else {
  const y = await p.evaluate(() => document.querySelector("#how [data-stage]").getBoundingClientRect().top + scrollY - 120);
  for (let v = 0; v < y; v += 150) { await p.evaluate((t) => window.scrollTo(0, t), v); await p.waitForTimeout(40); }
  await p.evaluate((t) => window.scrollTo(0, t), y);
  for (let i = 0; i < 12; i++) {
    await p.waitForTimeout(500);
    const f = `shots/how-${w}-f${String(i).padStart(2, "0")}.png`;
    await stage.screenshot({ path: f });
    out.push(f);
  }
}
console.log(out.join(" "));
await b.close();
