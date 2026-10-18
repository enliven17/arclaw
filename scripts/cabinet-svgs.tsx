/**
 * Writes public/cabinet/<variant>.svg: the static back of each claw machine (components/claw/geometry.tsx
 * cabinetBack) with the figure's styles inlined, since an SVG drawn through <image> sees no page CSS.
 * Runs before every build (package.json "build"); run it by hand after changing the cabinet art:
 *   pnpm exec tsx scripts/cabinet-svgs.tsx
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cabinetBack } from "../components/claw/geometry";
import { H, VARIANTS, W } from "../components/claw/view";

const css = readFileSync("components/claw/claw.css", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ")
  .replace(/\s*([{};:,>])\s*/g, "$1")
  .trim();

mkdirSync("public/cabinet", { recursive: true });
for (const v of VARIANTS) {
  const body = renderToStaticMarkup(createElement("g", { id: "back" }, cabinetBack(v)));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="claw-fig" data-machine="${v}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><style>${css}</style>${body}</svg>`;
  writeFileSync(`public/cabinet/${v}.svg`, svg);
  console.log(`public/cabinet/${v}.svg ${(svg.length / 1024).toFixed(0)} KB`);
}
