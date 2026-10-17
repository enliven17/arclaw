/** Gift section frames: desktop wheel-scrubs through the pin, mobile plays once. node scripts/gift-frames.mjs <w> <h> [--mobile] */
import { chromium } from "playwright-core";
const [w, h] = process.argv.slice(2, 4).map(Number);
const mobile = process.argv.includes("--mobile");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
await ctx.addInitScript(() => sessionStorage.setItem("arclaw:splash", "1"));
const p = await ctx.newPage();
await p.goto(process.env.BASE || "http://localhost:3210", { waitUntil: "networkidle" });
await p.waitForTimeout(2000);
const out = [];
const sel = mobile ? "#gift" : "#gift > div";
if (!mobile) {
  await p.mouse.move(w / 2, h / 2);
  const top = await p.evaluate(() => { const s = document.querySelector("#gift"); const sp = s.parentElement.classList.contains("pin-spacer") ? s.parentElement : s; return sp.getBoundingClientRect().top + scrollY; });
  while ((await p.evaluate(() => scrollY)) < top - 40) { await p.mouse.wheel(0, 240); await p.waitForTimeout(25); }
  for (let i = 0; i < 8; i++) {
    for (let k = 0; k < 2; k++) { await p.mouse.wheel(0, 115); await p.waitForTimeout(40); }
    await p.waitForTimeout(700);
    const f = `shots/gift-${w}-f${i}.png`;
    await p.locator(sel).screenshot({ path: f });
    out.push(f);
  }
} else {
  const y = await p.evaluate(() => document.querySelector("#gift [data-gift-stage]").getBoundingClientRect().top + scrollY - 200);
  for (let v = 0; v < y; v += 200) { await p.evaluate((t) => window.scrollTo(0, t), v); await p.waitForTimeout(30); }
  await p.evaluate((t) => window.scrollTo(0, t), y);
  for (let i = 0; i < 6; i++) { await p.waitForTimeout(700); const f = `shots/gift-${w}-f${i}.png`; await p.locator("#gift [data-gift-stage]").screenshot({ path: f }); out.push(f); }
}
console.log(out.join(" "));
await b.close();
