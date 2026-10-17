import { chromium } from "playwright-core";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => sessionStorage.setItem("arclaw:splash", "1"));
const p = await ctx.newPage();
await p.goto("http://localhost:3210", { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
await p.screenshot({ path: "shots/nav-top.png", clip: { x: 0, y: 0, width: 1440, height: 140 } });
await p.mouse.move(700, 450);
for (let i = 0; i < 30; i++) { await p.mouse.wheel(0, 150); await p.waitForTimeout(30); }
await p.waitForTimeout(900);
await p.screenshot({ path: "shots/nav-down.png", clip: { x: 0, y: 0, width: 1440, height: 140 } });
for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, -150); await p.waitForTimeout(60); }
await p.waitForTimeout(900);
await p.screenshot({ path: "shots/nav-up.png", clip: { x: 0, y: 0, width: 1440, height: 140 } });
const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await m.addInitScript(() => sessionStorage.setItem("arclaw:splash", "1"));
const q = await m.newPage();
await q.goto("http://localhost:3210", { waitUntil: "networkidle" });
await q.waitForTimeout(1500);
await q.screenshot({ path: "shots/nav-mobile.png", clip: { x: 0, y: 0, width: 390, height: 120 } });
await q.getByRole("button", { name: "Menu" }).click();
await q.waitForTimeout(600);
await q.screenshot({ path: "shots/nav-mobile-menu.png" });
await b.close();
