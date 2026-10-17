/**
 * Splash frames in a fresh session: node scripts/splash-shots.mjs <url> <prefix> [--mobile]
 * t = 0 is when the splash timeline has set its first frame (the rig gets an inline transform).
 */
import { chromium } from "playwright-core";

const [url, prefix] = process.argv.slice(2);
const mobile = process.argv.includes("--mobile");
const b = await chromium.launch();
for (const at of [0.5, 1.2, 1.8]) {
  const ctx = await b.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => Boolean(document.querySelector("[data-rig]")?.getAttribute("style")?.includes("transform")), null, { timeout: 60000 });
  const t0 = Date.now();
  await p.waitForTimeout(Math.max(0, at * 1000 - (Date.now() - t0) - 30));
  await p.screenshot({ path: `${prefix}-${String(at).replace(".", "_")}s.png` });
  console.log(`shot ${prefix} at ${at}s`);
  await ctx.close();
}
await b.close();
