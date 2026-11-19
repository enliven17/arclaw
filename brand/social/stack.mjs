/**
 * X post image: Solana, MagicBlock, Circle and xStocks, and how a play runs. 1600 x 900.
 * The partner marks are read from components/landing/BuiltOn.tsx, so the post and the site never drift.
 * Run: `node brand/social/stack.mjs` → brand/social/stack.png
 */
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CREAM, INK, logoSvg } from "../../lib/brand/logo.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MUTED = "#8B867D";
const PANEL = "#141417";
const LINE = "rgba(236,230,218,0.08)";
const font = (p) => `data:font/woff2;base64,${readFileSync(join(ROOT, "node_modules/geist/dist/fonts", p)).toString("base64")}`;

// The Solana and Circle marks, drawn in cream like on the site.
const marks = [...readFileSync(join(ROOT, "components/landing/BuiltOn.tsx"), "utf8").matchAll(/<svg viewBox="([^"]+)"[^>]*>([\s\S]*?)<\/svg>/g)].map(
  ([, box, inner]) => `<svg viewBox="${box}" height="64" fill="${CREAM}">${inner.replace(/\s*\/>/g, "/>")}</svg>`,
);
if (marks.length !== 2) throw new Error(`expected 2 partner marks in BuiltOn.tsx, found ${marks.length}`);

const PARTNERS = [
  { name: "Solana", handle: "solana.com", role: "The chain", mark: marks[0], line: "Every play, box and card settles on Solana. Network fees are paid in SOL." },
  { name: "MagicBlock", handle: "magicblock.gg", role: "The claw and draw", line: "Gasless claw moves on ephemeral rollups. Verifiable pack draws with MagicBlock VRF." },
  { name: "Circle", handle: "circle.com", role: "The money", mark: marks[1], line: "Pay Circle USDC for every box. Devnet uses faucet USDC with no monetary value." },
  { name: "xStocks", handle: "xstocks.com", role: "Future mainnet prizes", line: "Tokenized equities on Solana. The current devnet pays test stock tokens." },
];
const STEPS = ["Pay Circle USDC", "Steer and draw on MagicBlock", "Settle on Solana"];

const W = 1600, H = 900;
const html = `<!doctype html><html><head><style>
@font-face { font-family: Geist; src: url(${font("geist-sans/Geist-Medium.woff2")}); font-weight: 500; }
@font-face { font-family: Geist; src: url(${font("geist-sans/Geist-Regular.woff2")}); font-weight: 400; }
@font-face { font-family: GeistMono; src: url(${font("geist-mono/GeistMono-Regular.woff2")}); }
* { margin: 0; box-sizing: border-box; }
html, body { width: ${W}px; height: ${H}px; background: ${INK}; color: ${CREAM}; font-family: Geist; overflow: hidden; }
.mono { font-family: GeistMono; font-variant-numeric: tabular-nums; }
</style></head><body>
<div style="position:absolute;left:100px;top:84px;width:170px">${logoSvg.lockup("dark").replace("<svg ", '<svg width="170" ')}</div>
<h1 style="position:absolute;left:100px;top:170px;font-weight:500;font-size:84px;line-height:1;letter-spacing:-0.04em">Built on.</h1>
<div style="position:absolute;left:100px;right:100px;top:310px;display:grid;grid-template-columns:repeat(4,1fr);gap:20px">
  ${PARTNERS.map((p, i) => `
  <div style="background:${PANEL};border:1px solid ${LINE};border-radius:20px;padding:34px 36px;height:400px;display:flex;flex-direction:column">
    <div style="font-size:20px;color:${MUTED}">${p.role}</div>
    <div style="margin-top:22px;display:flex;align-items:center;gap:10px">${p.mark ? p.mark.replace('height="64"', 'height="28"') : ""}<span style="font-size:38px;letter-spacing:-0.04em">${p.name}</span></div>
    <div style="margin-top:auto;font-size:20px;line-height:1.45;color:${MUTED}">${p.line}</div>
    <div class="mono" style="margin-top:18px;font-size:20px">${p.handle}</div>
  </div>`).join("")}
</div>
<div style="position:absolute;left:100px;right:100px;bottom:80px;display:flex;gap:56px;font-size:24px">
  ${STEPS.map((s, i) => `<div style="display:flex;align-items:baseline;gap:14px"><span class="mono" style="color:#FF5A1F">${i + 1}</span><span>${s}</span></div>`).join("")}
  <div class="mono" style="margin-left:auto">arclaw.app</div>
</div>
</body></html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
writeFileSync(join(ROOT, "brand/social/stack.png"), await page.screenshot({ type: "png" }));
await browser.close();
console.log("wrote brand/social/stack.png");
