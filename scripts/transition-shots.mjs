/** Page transition frames: claw (landing to app), tab swap, cabinet morph. node scripts/transition-shots.mjs [--throttle 4] */
import { chromium } from "playwright-core";
const throttle = Number(process.argv.includes("--throttle") ? process.argv[process.argv.indexOf("--throttle") + 1] : 1);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => sessionStorage.setItem("arclaw:splash", "1"));
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
const base = process.env.BASE || "http://localhost:3210";
const burst = async (name, times) => {
  const t0 = Date.now();
  for (const t of times) {
    await p.waitForTimeout(Math.max(0, t - (Date.now() - t0)));
    await p.screenshot({ path: `shots/vt-${name}-${t}.png` });
  }
};
// Warm the routes so the transition is not waiting on dev compiles.
for (const u of ["/app/play", "/app/play/single", "/app/collection", "/"]) await p.goto(base + u, { waitUntil: "load" });
await p.waitForTimeout(1500);
if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
await p.evaluate(() => {
  window.__frames = [];
  let last = performance.now();
  const f = (t) => { window.__frames.push(t - last); last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
await p.getByRole("link", { name: "Open app" }).first().click();
await burst("claw", [150, 400, 560, 700, 850, 1000, 1200, 1500]);
await p.waitForURL("**/app/play");
await p.waitForTimeout(800);
await p.getByRole("link", { name: "Collection" }).first().click();
await burst("tab", [40, 120, 220, 360]);
await p.getByRole("link", { name: "Play" }).first().click();
await p.waitForTimeout(1200);
await p.getByRole("link", { name: /Enter Stack/ }).click();
await burst("morph", [60, 180, 320, 520]);
const r = await p.evaluate(() => { const f = window.__frames.slice(3); return { frames: f.length, over33: f.filter((d) => d > 33).length, worst: Math.round(Math.max(...f)) }; });
console.log(JSON.stringify({ throttle, ...r }));
await b.close();
