/**
 * Fetches official logos for the stocks simple-icons does not carry, recolours them to one cream tone and writes
 * public/logos/<TICKER>.svg plus public/logos/SOURCES.md. Run after scripts/logos.mjs: `node scripts/fetch-logos.mjs`.
 *
 * Recolouring: every fill, stroke and gradient becomes cream (#ECE6DA); near-white parts (knockouts such as text on
 * a coloured block) become the card panel tone (#141417) so they still read as cut-outs on the logo window.
 * Downloads are cached in .cache/logos (gitignored). The marks remain their owners' trademarks, used to identify
 * the stock a card pays.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache/logos");
const OUT = join(ROOT, "public/logos");
mkdirSync(CACHE, { recursive: true });

const CREAM = "#ECE6DA";
const KNOCKOUT = "#141417";
const commons = (file) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`;
const commonsPage = (file) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`;

/** ticker: [download url, human source] */
const SOURCES = {
  AMZN: [commons("Amazon 2024.svg"), commonsPage("Amazon 2024.svg")],
  MU: [commons("Micron Technology logo 2024.svg"), commonsPage("Micron Technology logo 2024.svg")],
  GME: [commons("GameStop Logo.svg"), commonsPage("GameStop Logo.svg")],
  COST: [commons("Costco Wholesale logo 2010-10-26.svg"), commonsPage("Costco Wholesale logo 2010-10-26.svg")],
  MSTR: [commons("Strategy logo (2025).svg"), commonsPage("Strategy logo (2025).svg")],
  HIMS: [commons("Hims logo (2026).svg"), commonsPage("Hims logo (2026).svg")],
  LLY: [commons("Eli Lilly and Company.svg"), commonsPage("Eli Lilly and Company.svg")],
  AMC: [commons("AMC Theatres logo.svg"), commonsPage("AMC Theatres logo.svg")],
  DJT: [commons("Trump Media & Technology Group logo.svg"), commonsPage("Trump Media & Technology Group logo.svg")],
  SGOV: [commons("Logo-ishares 2019.svg"), `${commonsPage("Logo-ishares 2019.svg")} (iShares, the fund's issuer)`],
  SLV: [commons("Logo-ishares 2019.svg"), `${commonsPage("Logo-ishares 2019.svg")} (iShares, the fund's issuer)`],
  QQQ: ["https://www.invesco.com/etc.clientlibs/invesco/clientlib-global/clientlib/resources/images/logo-new.svg", "invesco.com site logo (Invesco, the fund's issuer)"],
  SPY: ["https://www.ssga.com/library-content/images/site/state-street-investment-management-logo.svg", "ssga.com site logo (State Street, the SPDR issuer)"],
  GLD: ["https://www.ssga.com/library-content/images/site/state-street-investment-management-logo.svg", "ssga.com site logo (State Street, the SPDR issuer)"],
  USO: ["https://www.uscfinvestments.com/site-template/assets/images/uscf-logo.svg", "uscfinvestments.com site logo (USCF, the fund's issuer)"],
};

const UA = "Mozilla/5.0 (arclaw logo fetch; https://arclaw.app)";

async function fetchSvg(ticker, url) {
  const file = join(CACHE, `${ticker}.svg`);
  if (existsSync(file)) return readFileSync(file, "utf8");
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`${ticker}: HTTP ${res.status} for ${url}`);
  const text = await res.text();
  if (!text.includes("<svg")) throw new Error(`${ticker}: not an SVG (${url})`);
  writeFileSync(file, text);
  await new Promise((r) => setTimeout(r, 1500));
  return text;
}

const NAMED = { white: "#ffffff", black: "#000000", red: "#ff0000", blue: "#0000ff", navy: "#000080", gray: "#808080", grey: "#808080" };

function luminance(color) {
  let c = color.trim().toLowerCase();
  if (NAMED[c]) c = NAMED[c];
  let r, g, b;
  const rgb = c.match(/^rgba?\(([^)]+)\)/);
  if (rgb) [r, g, b] = rgb[1].split(",").map((v) => parseFloat(v) / 255);
  else if (/^#[0-9a-f]{3,8}$/.test(c)) {
    const hex = c.length <= 5 ? c.slice(1, 4).split("").map((h) => h + h).join("") : c.slice(1, 7);
    [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  } else return null;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const mapColor = (value) => {
  const v = value.trim();
  if (!v || v === "none" || v === "transparent" || v === "currentColor" || v === "inherit") return v;
  if (v.startsWith("url(")) return CREAM;
  const l = luminance(v);
  if (l === null) return CREAM;
  return l > 0.88 ? KNOCKOUT : CREAM;
};

function recolour(svg) {
  let s = svg
    .replace(/<\?xml[^>]*>/g, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(metadata|title|desc)[\s\S]*?<\/\1>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");
  // Attributes: fill, stroke, stop-color, color.
  s = s.replace(/\b(fill|stroke|stop-color|color)="([^"]*)"/g, (_, k, v) => `${k}="${mapColor(v)}"`);
  // Inline styles and <style> blocks.
  s = s.replace(/\b(fill|stroke|stop-color|color)\s*:\s*([^;"}]+)/g, (_, k, v) => `${k}:${mapColor(v)}`);
  // Elements with no fill inherit black: give the root a cream default.
  s = s.replace(/<svg\b([^>]*)>/, (m, attrs) => (/\bfill=/.test(attrs) ? m : `<svg${attrs} fill="${CREAM}">`));
  // Drop fixed pixel sizes so it scales to its box; keep the viewBox.
  s = s.replace(/<svg\b([^>]*)>/, (m, attrs) => {
    let a = attrs;
    const w = a.match(/\bwidth="([\d.]+)(px)?"/);
    const h = a.match(/\bheight="([\d.]+)(px)?"/);
    if (!/viewBox=/.test(a) && w && h) a += ` viewBox="0 0 ${w[1]} ${h[1]}"`;
    a = a.replace(/\s(width|height)="[^"]*"/g, "");
    return `<svg${a}>`;
  });
  return s.trim() + "\n";
}

const lines = [
  "# Logo sources",
  "",
  "Every file here is a single-colour cream (#ECE6DA) version of the company's or fund issuer's own mark, used only to",
  "identify the stock a card pays. The marks remain trademarks of their owners.",
  "",
  "Brand marks from simple-icons (CC0 path data): NVDA, TSLA, AAPL, META, GOOGL, AMD, INTC, RDDT, RBLX, DELL, AVGO,",
  "SPCX (SpaceX), CRCL (Circle, simple-icons source circle.com). MSFT is drawn here as the four squares.",
  "Written by `scripts/logos.mjs`.",
  "",
  "Fetched and recoloured by `scripts/fetch-logos.mjs`:",
  "",
  "| Ticker | Source |",
  "|---|---|",
];

for (const [ticker, [url, source]] of Object.entries(SOURCES)) {
  const raw = await fetchSvg(ticker, url);
  writeFileSync(join(OUT, `${ticker}.svg`), recolour(raw));
  lines.push(`| ${ticker} | ${source} |`);
  console.log(`ok ${ticker}`);
}
writeFileSync(join(OUT, "SOURCES.md"), `${lines.join("\n")}\n`);
console.log("wrote public/logos/SOURCES.md");
