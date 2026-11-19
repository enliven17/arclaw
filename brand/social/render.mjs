/**
 * Social kit: profile pictures and banners, drawn from lib/brand/logo.ts so they never drift from the site.
 * Run: `node brand/social/render.mjs` (uses playwright-core with the local Chromium, like scripts/shots.mjs).
 */
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAW, CREAM, INK, logoSvg, markInner, MARK_SIZE } from "../../lib/brand/logo.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = join(ROOT, "brand/social");
// Inline the fonts: setContent pages are about:blank and cannot load file:// URLs.
const font = (p) => `data:font/woff2;base64,${readFileSync(join(ROOT, "node_modules/geist/dist/fonts", p)).toString("base64")}`;
const icon = (slug) =>
  readFileSync(join(ROOT, "node_modules/simple-icons/icons", `${slug}.svg`), "utf8").replace("<svg ", `<svg fill="${CREAM}" `);

const PANEL = "#141417";
const MUTED = "#8B867D";
const PRIZE = "#E9C46A";
const LINE = "rgba(236,230,218,0.08)";

const page = (w, h, body) => `<!doctype html><html><head><style>
@font-face { font-family: Geist; src: url(${font("geist-sans/Geist-Medium.woff2")}); font-weight: 500; }
@font-face { font-family: Geist; src: url(${font("geist-sans/Geist-Regular.woff2")}); font-weight: 400; }
@font-face { font-family: GeistMono; src: url(${font("geist-mono/GeistMono-Regular.woff2")}); }
* { margin: 0; box-sizing: border-box; }
html, body { width: ${w}px; height: ${h}px; background: ${INK}; color: ${CREAM}; font-family: Geist; overflow: hidden; }
.mono { font-family: GeistMono; font-variant-numeric: tabular-nums; }
</style></head><body>${body}</body></html>`;

const mark = (size, tone = "dark") =>
  `<svg viewBox="0 0 ${MARK_SIZE} ${MARK_SIZE}" width="${size}" height="${size}">${markInner(tone)}</svg>`;

const card = ({ slug, ticker, name, amount, tier }, rot, x, y) => `
<div style="position:absolute;left:${x}px;top:${y}px;width:210px;height:294px;transform:rotate(${rot}deg);
  background:${PANEL};border:1px solid ${LINE};border-radius:14px;padding:18px 20px;display:flex;flex-direction:column">
  <div style="display:flex;justify-content:space-between;align-items:baseline">
    <div class="mono" style="font-size:18px">${ticker}</div>
    <div style="font-size:13px;color:${PRIZE}">${tier}</div>
  </div>
  <div style="flex:1;display:grid;place-items:center;margin:10px 0;border:1px solid ${LINE};border-radius:10px">
    ${icon(slug).replace("<svg ", '<svg width="96" height="96" ')}
  </div>
  <div style="display:flex;justify-content:space-between;align-items:baseline">
    <div style="font-size:15px;color:${MUTED}">${name}</div>
    <div class="mono" style="font-size:16px">${amount}</div>
  </div>
</div>`;

const CARDS = [
  { slug: "apple", ticker: "AAPL", name: "Apple", amount: "0.80 USDC", tier: "Uncommon" },
  { slug: "nvidia", ticker: "NVDA", name: "NVIDIA", amount: "10.00 USDC", tier: "Jackpot" },
  { slug: "tesla", ticker: "TSLA", name: "Tesla", amount: "1.20 USDC", tier: "Rare" },
];

const banner = (w, h) =>
  page(
    w,
    h,
    `<div style="position:absolute;left:96px;top:84px">${logoSvg.lockup("dark").replace("<svg ", '<svg height="40" ')}</div>
     <div style="position:absolute;left:96px;top:176px;font-size:76px;font-weight:500;letter-spacing:-0.035em;line-height:1">Grab a box.<br/>Pull real stocks.</div>
     <div style="position:absolute;left:96px;top:356px;font-size:24px;color:${MUTED}">Claw machines on Solana. Powered by MagicBlock.</div>
     ${card(CARDS[0], -8, w - 700, 110)}${card(CARDS[2], 8, w - 270, 110)}${card(CARDS[1], 0, w - 485, 86)}`,
  );

const JOBS = [
  // Profile pictures: platforms crop to a circle, so the mark sits inside the inscribed circle.
  ["profile.png", 1000, 1000, page(1000, 1000, `<div style="display:grid;place-items:center;height:100%">${mark(560)}</div>`)],
  [
    "profile-claw.png",
    1000,
    1000,
    page(1000, 1000, `<div style="display:grid;place-items:center;height:100%;background:${CLAW}">${mark(560, "light").replaceAll(CLAW, INK)}</div>`),
  ],
  // ponytail: one 3:1 banner (X, Farcaster, Discord). Add a 4:1 LinkedIn layout when that account exists.
  ["banner.png", 1500, 500, banner(1500, 500)],
];

const browser = await chromium.launch({ headless: true });
for (const [name, w, h, html] of JOBS) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.setContent(html, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: join(OUT, name) });
  await p.close();
}
await browser.close();
console.log(`wrote ${JOBS.length} images to brand/social`);
