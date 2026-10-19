/**
 * X post image: what arclaw is built on (Arc, Astock, D20DAO) and how one play runs through them. 1600 x 900.
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

// Arc, Astock, D20 marks, in BuiltOn.tsx order, drawn in cream like on the site.
const marks = [...readFileSync(join(ROOT, "components/landing/BuiltOn.tsx"), "utf8").matchAll(/<svg viewBox="([^"]+)"[^>]*>([\s\S]*?)<\/svg>/g)].map(
  ([, box, inner]) => `<svg viewBox="${box}" height="64" fill="${CREAM}">${inner.replace(/\s*\/>/g, "/>")}</svg>`,
);
if (marks.length !== 3) throw new Error(`expected 3 partner marks in BuiltOn.tsx, found ${marks.length}`);

const PARTNERS = [
  { name: "Arc", handle: "@arc", role: "The chain", line: "Circle's Layer-1, where USDC is the gas. Every play, box and card is on chain." },
  { name: "Astock", handle: "@TryArcStocks", role: "The stocks", line: "Every card is a tokenized stock, bought on the Astock desk and sent to your wallet." },
  { name: "D20DAO", handle: "@d20dao", role: "The draw", line: "Verifiable randomness on Arc. Anyone can replay the proof behind a box." },
];
const STEPS = ["Pay USDC on Arc", "D20 draws your box", "Astock stocks land in your wallet"];

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
<div style="position:absolute;left:100px;right:100px;top:310px;display:grid;grid-template-columns:repeat(3,1fr);gap:28px">
  ${PARTNERS.map((p, i) => `
  <div style="background:${PANEL};border:1px solid ${LINE};border-radius:20px;padding:34px 36px;height:400px;display:flex;flex-direction:column">
    <div style="font-size:20px;color:${MUTED}">${p.role}</div>
    <div style="margin-top:22px;display:flex;align-items:center;gap:20px">${marks[i]}<span style="font-size:58px;letter-spacing:-0.04em">${p.name}</span></div>
    <div style="margin-top:auto;font-size:22px;line-height:1.45;color:${MUTED}">${p.line}</div>
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
