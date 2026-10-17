/** Contact sheet: node scripts/sheet.mjs out.png cols cropX cropY cropW cropH img1 img2 ... */
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const [out, cols, cx, cy, cw, ch, ...imgs] = process.argv.slice(2);
const c = Number(cols), w = Number(cw), h = Number(ch);
const cells = imgs.map((p) => `<div style="width:${w}px;height:${h}px;overflow:hidden;position:relative;background:#000"><img src="data:image/png;base64,${readFileSync(p).toString("base64")}" style="position:absolute;left:${-cx}px;top:${-cy}px"/><span style="position:absolute;left:4px;top:4px;color:#fff;font:11px monospace">${p.split("/").pop()}</span></div>`).join("");
const html = `<body style="margin:0;background:#222"><div style="display:grid;grid-template-columns:repeat(${c},${w}px);gap:2px">${cells}</div></body>`;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: c * (w + 2), height: Math.ceil(imgs.length / c) * (h + 2) } });
await pg.setContent(html);
await pg.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);
