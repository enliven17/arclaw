/**
 * X post image: the Single machine as the site draws it, and the invitation to come play. 1600 x 900 (16:9).
 * Run: `node brand/social/grab.mjs [site url]` (default https://www.arclaw.app) → brand/social/grab.png
 */
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CREAM, INK, logoSvg } from "../../lib/brand/logo.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SITE = process.argv[2] ?? "https://www.arclaw.app";
const MUTED = "#8B867D";
const font = (p) => `data:font/woff2;base64,${readFileSync(join(ROOT, "node_modules/geist/dist/fonts", p)).toString("base64")}`;

const browser = await chromium.launch({ headless: true });

// 1. The machine, from the live page at 2x, on its own background.
const live = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await live.addInitScript(() => {
  localStorage.setItem("arclaw:age-ok", "1");
  localStorage.setItem("arclaw:ack-18", "1");
  sessionStorage.setItem("arclaw:splash", "1");
});
await live.emulateMedia({ reducedMotion: "reduce" });
await live.goto(`${SITE}/app/play/single`, { waitUntil: "networkidle", timeout: 90000 });
await live.waitForTimeout(2500);
const machine = (await live.getByLabel("The Single machine.").first().screenshot({ omitBackground: true })).toString("base64");

// 2. The post.
const W = 1600, H = 900;
const html = `<!doctype html><html><head><style>
@font-face { font-family: Geist; src: url(${font("geist-sans/Geist-Medium.woff2")}); font-weight: 500; }
@font-face { font-family: Geist; src: url(${font("geist-sans/Geist-Regular.woff2")}); font-weight: 400; }
@font-face { font-family: GeistMono; src: url(${font("geist-mono/GeistMono-Regular.woff2")}); }
* { margin: 0; box-sizing: border-box; }
html, body { width: ${W}px; height: ${H}px; background: ${INK}; color: ${CREAM}; font-family: Geist; overflow: hidden; }
.mono { font-family: GeistMono; font-variant-numeric: tabular-nums; }
</style></head><body>
<div style="position:absolute;left:110px;top:96px;width:200px">${logoSvg.lockup("dark").replace("<svg ", '<svg width="200" ')}</div>
<div style="position:absolute;left:110px;top:270px;width:760px">
  <h1 style="font-weight:500;font-size:112px;line-height:0.98;letter-spacing:-0.045em">Come grab<br>a box.</h1>
  <p style="margin-top:40px;font-size:34px;line-height:1.3;letter-spacing:-0.01em">arclaw is live on Solana devnet.</p>
  <p style="margin-top:14px;font-size:28px;line-height:1.4;color:${MUTED}"><span class="mono" style="color:${CREAM}">1 USDC</span> a play. Every play wins a pack of real stocks.</p>
</div>
<div class="mono" style="position:absolute;left:110px;bottom:92px;font-size:28px">arclaw.app</div>
<img src="data:image/png;base64,${machine}" style="position:absolute;right:40px;top:-70px;height:1040px" />
</body></html>`;
const post = await browser.newPage({ viewport: { width: W, height: H } });
await post.setContent(html, { waitUntil: "load" });
await post.evaluate(() => document.fonts.ready);
writeFileSync(join(ROOT, "brand/social/grab.png"), await post.screenshot({ type: "png" }));
await browser.close();
console.log("wrote brand/social/grab.png");
