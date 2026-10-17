/** Reveal states from /dev/reveal: node scripts/reveal-shots.mjs <w> <h> <kind> [--mobile] */
import { chromium } from "playwright-core";
const [w, h, kind] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4] ?? "rare"];
const mobile = process.argv.includes("--mobile");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
await ctx.addInitScript(() => sessionStorage.setItem("arclaw:splash", "1"));
const p = await ctx.newPage();
await p.goto(`http://localhost:3210/dev/reveal?kind=${kind}`, { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
const stage = p.locator("dialog [role=button][aria-label]").first();
const shot = (n) => p.screenshot({ path: `shots/reveal-${kind}-${w}-${n}.png` });
await shot("1-box");
await stage.click(); await p.waitForTimeout(1300); await shot("2-pack");
await stage.click(); await p.waitForTimeout(350); await shot("3-tearing"); await p.waitForTimeout(900);
await stage.click(); await p.waitForTimeout(800); await shot("4-dealt-one");
await stage.click(); await p.waitForTimeout(800); await stage.click(); await p.waitForTimeout(900); await shot("5-dealt");
const cards = p.locator("dialog [data-rv-card]");
await cards.nth(1).click(); await p.waitForTimeout(350); await shot("6-flipping"); await p.waitForTimeout(900);
await cards.nth(0).click(); await p.waitForTimeout(900); await cards.nth(2).click(); await p.waitForTimeout(1500); await shot("7-done");
if (kind === "many") { await p.getByRole("button", { name: /See all|Skip to summary/ }).first().click(); await p.waitForTimeout(600); await shot("8-summary"); }
await b.close();
console.log("ok", kind, w);
