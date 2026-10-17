import { chromium } from "playwright-core";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => sessionStorage.setItem("arclaw:splash", "1"));
const p = await ctx.newPage();
await p.goto("http://localhost:3210", { waitUntil: "networkidle" });
await p.waitForTimeout(2000);
const st = () => p.evaluate(() => { const how = document.querySelector("#how"); return { y: scrollY, top: Math.round(how.querySelector("[data-stage]").getBoundingClientRect().top), cards: [...how.querySelectorAll("[data-card]")].map((c) => (+getComputedStyle(c).opacity).toFixed(2)), inner: [...how.querySelectorAll("[data-card-inner]")].map((c) => (c.style.transform.match(/rotateY\(([-\d.]+)/) || [0, "none"])[1]) }; });
const target = await p.evaluate(() => document.querySelector("#how [data-stage]").getBoundingClientRect().top + scrollY - 300);
for (let y = 0; y < target + 600; y += 100) { await p.evaluate((v) => window.scrollTo(0, v), y); await p.waitForTimeout(150); }
for (let i = 0; i < 6; i++) { console.log(JSON.stringify(await st())); await p.waitForTimeout(700); }
await b.close();
