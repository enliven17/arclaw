/** Splash frames (first paint, 0.3, 1.2, 2.4, 2.9 s) and long tasks during it: node scripts/splash-profile.mjs <w> <h> [--mobile] */
import { chromium } from "playwright-core";
const [w, h] = process.argv.slice(2, 4).map(Number);
const mobile = process.argv.includes("--mobile");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
await ctx.addInitScript(() => {
  window.__long = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.startTime) + ":" + Math.round(e.duration)))).observe({ type: "longtask", buffered: true });
  window.__frames = [];
  let last = performance.now();
  const f = (t) => { window.__frames.push(t - last); last = t; if (document.documentElement.classList.contains("splashing") || window.__frames.length < 20) requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
const p = await ctx.newPage();
await p.goto(process.env.BASE || "http://localhost:3210", { waitUntil: "commit" });
await p.waitForSelector(".splash", { state: "attached" });
await p.screenshot({ path: `shots/splash-${w}-paint.png` });
await p.waitForFunction(() => Boolean(document.querySelector("[data-coin]")?.getAttribute("style")?.includes("opacity")), null, { timeout: 60000 });
const t0 = Date.now();
for (const at of [0.3, 1.2, 2.4, 2.9]) {
  await p.waitForTimeout(Math.max(0, at * 1000 - (Date.now() - t0)));
  await p.screenshot({ path: `shots/splash-${w}-${String(at).replace(".", "_")}s.png` });
}
await p.waitForFunction(() => !document.documentElement.classList.contains("splashing"), null, { timeout: 15000 });
const r = await p.evaluate(() => {
  const fr = window.__frames.slice(2);
  const over = fr.filter((d) => d > 20).length;
  const coinAt = performance.getEntriesByName("splash-start")[0]?.startTime;
  return { coinAt, longTasks: window.__long, frames: fr.length, droppedOver20ms: over, worstFrameMs: Math.round(Math.max(...fr)) };
});
console.log(JSON.stringify(r));
await b.close();
