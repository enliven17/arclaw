/** Renders every public/logos/*.svg in a card-like logo window: node scripts/logo-sheet.mjs out.png */
import { chromium } from "playwright-core";
import { readdirSync, readFileSync } from "node:fs";
const files = readdirSync("public/logos").filter((f) => f.endsWith(".svg"));
const cells = files.map((f) => `<div style="width:150px;height:170px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:#141417;border:1px solid rgba(236,230,218,.12);border-radius:10px"><img src="data:image/svg+xml;base64,${readFileSync(`public/logos/${f}`).toString("base64")}" style="width:96px;height:96px"/><span style="color:#8b867d;font:12px monospace">${f}</span></div>`).join("");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 8 * 158, height: 800 } });
await p.setContent(`<body style="margin:0;background:#0c0c0e;padding:4px"><div style="display:grid;grid-template-columns:repeat(8,150px);gap:8px">${cells}</div></body>`);
await p.screenshot({ path: process.argv[2], fullPage: true });
await b.close();
