import { chromium } from "playwright-core";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("http://localhost:3210", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => Boolean(document.querySelector("[data-rig]")?.getAttribute("style")?.includes("transform")), null, { timeout: 60000 });
await p.waitForTimeout(1200);
console.log(await p.evaluate(() => { const w = document.querySelector("[data-word]"); const r = w.getBoundingClientRect(); const rig = document.querySelector("[data-rig]").getBoundingClientRect(); return { word: [r.x, r.y, r.width, r.height], style: w.getAttribute("style"), op: getComputedStyle(w).opacity, rig: [rig.x, rig.y, rig.width, rig.height] }; }));
await b.close();
