/**
 * Writes public/cabinet/<variant>.svg: the static back of each claw machine (geometry.tsx cabinetBack), drawn once and
 * shown by every <ClawMachine> through `<use href="/cabinet/<variant>.svg#back">`, so a page carries one small
 * cached file per finish instead of a copy of the cabinet per machine. Firefox and Safari do not apply page CSS to a
 * `<use>` copy (the cabinet came out as black shapes), so nothing may depend on a stylesheet: fill, stroke, opacity
 * and the rest are read back from a real browser (computed style) and written onto each element as attributes.
 *
 * Needs a local Chromium (playwright-core). The output is committed; run it again after changing the cabinet art or
 * components/claw/claw.css:  pnpm cabinet
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright-core";
import { cabinetBack } from "../components/claw/geometry";
import { H, VARIANTS, W } from "../components/claw/view";

async function main() {
const css = readFileSync("components/claw/claw.css", "utf8");
const browser = await chromium.launch();
const baked: Record<string, string> = {};
  mkdirSync("public/cabinet", { recursive: true });

for (const v of VARIANTS) {
  const markup = renderToStaticMarkup(createElement("g", { id: "bake" }, cabinetBack(v)));
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><style>${css}</style><div class="claw-fig" data-machine="${v}"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${markup}</svg></div>`);
  baked[v] = await page.evaluate(() => {
    const root = document.getElementById("bake")!;
    // Inherited properties are written only where they differ from the parent; the others wherever not default.
    const INHERITED = ["fill", "fill-opacity", "stroke", "stroke-opacity", "stroke-width", "stroke-linecap", "stroke-linejoin"];
    const OWN = ["opacity", "vector-effect"];
    const DEFAULT: Record<string, string> = {
      fill: "rgb(0, 0, 0)",
      "fill-opacity": "1",
      stroke: "none",
      "stroke-opacity": "1",
      "stroke-width": "1px",
      "stroke-linecap": "butt",
      "stroke-linejoin": "miter",
      opacity: "1",
      "vector-effect": "none",
    };
    // Two passes: read every element's style first, then write. Dropping classes while walking would change what
    // the selectors of the elements still to come match.
    const all = [root, ...Array.from(root.querySelectorAll<SVGElement>("*"))];
    const todo = all.map((el) => {
      const cs = getComputedStyle(el);
      const up = el === root ? null : getComputedStyle(el.parentElement!);
      const attrs: [string, string][] = [];
      for (const a of INHERITED) {
        const val = cs.getPropertyValue(a);
        if (val !== (up ? up.getPropertyValue(a) : DEFAULT[a])) attrs.push([a, val]);
      }
      for (const a of OWN) {
        const val = cs.getPropertyValue(a);
        if (val && val !== DEFAULT[a]) attrs.push([a, val]);
      }
      let style = "";
      if (cs.filter !== "none") style += `filter:${cs.filter};`;
      if (cs.transform !== "none") style += `transform:${cs.transform};`;
      return { el, attrs, style };
    });
    for (const { el, attrs, style } of todo) {
      for (const [a, val] of attrs) el.setAttribute(a, val);
      if (style) el.setAttribute("style", style);
      for (const n of el.getAttributeNames()) if (n === "class" || n.startsWith("data-")) el.removeAttribute(n);
    }
    return root.innerHTML;
  });
  await page.close();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><g id="back">${baked[v]}</g></svg>`;
  writeFileSync(`public/cabinet/${v}.svg`, svg);
  console.log(`public/cabinet/${v}.svg ${(svg.length / 1024).toFixed(0)} KB`);
}
await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
