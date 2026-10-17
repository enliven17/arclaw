import { chromium } from "playwright-core";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("http://localhost:3210", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
console.log(await p.evaluate(() => [...document.querySelectorAll("#hero-title .split-line > span")].map((s) => [s.getAttribute("style"), getComputedStyle(s).transform, getComputedStyle(s).opacity, getComputedStyle(s.closest("h1")).opacity, s.closest("h1").getAttribute("style"), getComputedStyle(s).color])));
await b.close();
