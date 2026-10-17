import { chromium } from "playwright-core";
const w = Number(process.argv[2] ?? 1440), h = Number(process.argv[3] ?? 900);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: w, height: h } });
await ctx.addInitScript(() => sessionStorage.setItem("arclaw:splash", "1"));
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto("http://localhost:3210", { waitUntil: "networkidle" });
await p.waitForTimeout(2000);
await p.mouse.move(w / 2, h / 2);
const state = () => p.evaluate(() => {
  const how = document.querySelector("#how");
  const top = Math.round(how.getBoundingClientRect().top);
  const cards = [...how.querySelectorAll("[data-card]")].map((c) => { const s = getComputedStyle(c); return `${(+s.opacity).toFixed(2)}|${c.style.transform.replace(/translate|rotate|scale|\(|\)|px|deg|,/g, " ").replace(/\s+/g," ").trim().slice(0,40)}`; });
  const inner = [...how.querySelectorAll("[data-card-inner]")].map((c) => c.style.transform + " || " + getComputedStyle(c.querySelector("[data-side=front]")).backfaceVisibility);
  const pack = how.querySelector("[data-pack]"); const box = how.querySelector("[data-box]");
  return { y: Math.round(scrollY), top, act: [...how.querySelectorAll("[data-step]")].findIndex((s) => s.hasAttribute("data-active")), box: getComputedStyle(box).opacity, pack: getComputedStyle(pack).opacity, cards, inner };
});
for (let i = 0; i < 60; i++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(60); if (i % 6 === 5) console.log(JSON.stringify(await state())); }
console.log("--- up");
for (let i = 0; i < 30; i++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(60); if (i % 6 === 5) console.log(JSON.stringify(await state())); }
console.log(errs.join("\n"));
await b.close();
