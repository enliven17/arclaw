/**
 * Screenshots with playwright-core and the locally installed Chromium.
 *
 *   node scripts/dev/shots.mjs <url> <out.png> [--w 1440] [--h 900] [--scroll 1200] [--eval "js"] [--wait 800]
 *                          [--selector "#how"] [--full] [--reduced] [--scale 1] [--mobile]
 *
 * Several shots in one browser: pass a JSON plan with --plan plan.json ([{ out, scroll, eval, wait, selector }]).
 */
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);
const [url, out] = args;
const w = Number(flag("w", 1440));
const h = Number(flag("h", 900));
const mobile = has("mobile");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: w, height: h },
  deviceScaleFactor: Number(flag("scale", 1)),
  reducedMotion: has("reduced") ? "reduce" : "no-preference",
  isMobile: mobile,
  hasTouch: mobile,
});
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: process.env.WAIT || "networkidle", timeout: 180000 });
await page.waitForTimeout(Number(flag("settle", 900)));

const plan = flag("plan") ? JSON.parse(readFileSync(flag("plan"), "utf8")) : [{ out, scroll: flag("scroll"), eval: flag("eval"), wait: flag("wait"), selector: flag("selector"), full: has("full") }];
for (const step of plan) {
  if (step.to) {
    // Scroll to a section top plus an offset (pins included: their spacer wraps them).
    step.scroll = await page.evaluate(({ sel, off }) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const spacer = el.parentElement?.classList.contains("pin-spacer") ? el.parentElement : el;
      return Math.max(0, Math.round(spacer.getBoundingClientRect().top + scrollY + off));
    }, { sel: step.to, off: step.offset ?? 0 });
  }
  if (step.scroll !== undefined && step.scroll !== null) {
    const target = Number(step.scroll);
    // Wheel in small steps so Lenis and ScrollTrigger see real input; fall back to scrollTo on touch.
    if (mobile) await page.evaluate((y) => window.scrollTo(0, y), target);
    else {
      await page.mouse.move(w / 2, h / 2);
      const now = await page.evaluate(() => window.scrollY);
      let left = target - now;
      while (Math.abs(left) > 1) {
        const d = Math.sign(left) * Math.min(Math.abs(left), 120);
        await page.mouse.wheel(0, d);
        left -= d;
        await page.waitForTimeout(16);
      }
    }
  }
  if (step.selector) await page.locator(step.selector).first().scrollIntoViewIfNeeded();
  if (step.eval) await page.evaluate(step.eval);
  await page.waitForTimeout(Number(step.wait ?? 900));
  await page.screenshot({ path: step.out, fullPage: Boolean(step.full) });
  console.log(`shot ${step.out}`);
}
if (errors.length) console.log(`console errors:\n${errors.join("\n")}`);
await browser.close();
