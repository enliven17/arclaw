/**
 * Writes public/logos/<TICKER>.svg in cream (#ECE6DA), one per stock in lib/stocks.ts. Brand marks come from
 * simple-icons (CC0 data; the marks remain their owners' trademarks, used here to identify the stock). Where
 * simple-icons has no mark (ETFs, and brands it does not carry) a monogram is traced from Geist Medium so it never
 * depends on a font; scripts/assets/fetch-logos.mjs then replaces those with official marks. Run: `node scripts/assets/logos.mjs`.
 */
import * as si from "simple-icons";
import opentype from "opentype.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "public/logos");
mkdirSync(OUT, { recursive: true });
const CREAM = "#ECE6DA";

const MARKS = {
  NVDA: "siNvidia",
  TSLA: "siTesla",
  AAPL: "siApple",
  META: "siMeta",
  GOOGL: "siGoogle",
  AMD: "siAmd",
  INTC: "siIntel",
  RDDT: "siReddit",
  RBLX: "siRoblox",
  DELL: "siDell",
  AVGO: "siBroadcom",
  SPCX: "siSpacex",
  CRCL: "siCircle",
};

const src = readFileSync(join(ROOT, "lib/stocks.ts"), "utf8");
const tickers = [...src.matchAll(/ticker: "([A-Z]+)"/g)].map((m) => m[1]);

const buf = readFileSync(join(ROOT, "lib/og/fonts/Geist-Medium.ttf"));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

/** Ticker letters as one path, fitted inside a 24 unit tile with a hairline frame. */
function monogram(ticker) {
  const text = ticker.length > 4 ? ticker.slice(0, 4) : ticker;
  const size = 100;
  const p = font.getPath(text, 0, 0, size, { letterSpacing: -0.02 });
  const b = p.getBoundingBox();
  const w = b.x2 - b.x1;
  const h = b.y2 - b.y1;
  const box = 15;
  const s = Math.min(box / w, (box * 0.62) / h);
  const ox = 12 - (w * s) / 2 - b.x1 * s;
  const oy = 12 - (h * s) / 2 - b.y1 * s;
  const r = (v) => String(Math.round(v * 100) / 100);
  const d = p.commands
    .map((c) => {
      const X = (v) => r(ox + v * s);
      const Y = (v) => r(oy + v * s);
      if (c.type === "M" || c.type === "L") return `${c.type}${X(c.x)} ${Y(c.y)}`;
      if (c.type === "Q") return `Q${X(c.x1)} ${Y(c.y1)} ${X(c.x)} ${Y(c.y)}`;
      if (c.type === "C") return `C${X(c.x1)} ${Y(c.y1)} ${X(c.x2)} ${Y(c.y2)} ${X(c.x)} ${Y(c.y)}`;
      return "Z";
    })
    .join("");
  return `<rect x="0.75" y="0.75" width="22.5" height="22.5" rx="5" fill="none" stroke="${CREAM}" stroke-opacity="0.5" stroke-width="1.5"/><path fill="${CREAM}" d="${d}"/>`;
}

/** Microsoft's four squares are simple geometry; drawn here rather than borrowed. */
const MSFT = `<path fill="${CREAM}" d="M1 1h10.5v10.5H1zM12.5 1H23v10.5H12.5zM1 12.5h10.5V23H1zM12.5 12.5H23V23H12.5z"/>`;

let marks = 0;
for (const t of tickers) {
  let body;
  if (t === "MSFT") body = MSFT;
  else if (MARKS[t] && si[MARKS[t]]) {
    body = `<path fill="${CREAM}" d="${si[MARKS[t]].path}"/>`;
    marks++;
  } else if (existsSync(join(OUT, `${t}.svg`)) && !readFileSync(join(OUT, `${t}.svg`), "utf8").includes("stroke-opacity=\"0.5\"")) {
    // An official logo from scripts/assets/fetch-logos.mjs is already there; keep it.
    continue;
  } else body = monogram(t);
  writeFileSync(join(OUT, `${t}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">${body}</svg>\n`);
}
console.log(`wrote ${tickers.length} logos (${marks} brand marks, the rest monograms)`);
