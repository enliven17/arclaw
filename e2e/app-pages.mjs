/** Screenshots of the app pages with a connected test wallet: node e2e/app-pages.mjs [w] [h] */
import { connect, openWithWallet } from "./wallet.mjs";
const w = Number(process.argv[2] ?? 1440);
const h = Number(process.argv[3] ?? 900);
const { browser, page, errors } = await openWithWallet({ w, h });
const base = process.env.BASE ?? "http://localhost:3210";
await page.goto(`${base}/app/collection`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: `shots/app-${w}-collection-disconnected.png` });
await connect(page);
await page.waitForFunction(() => !/Reading/.test(document.body.innerText), null, { timeout: 120000 });
await page.screenshot({ path: `shots/app-${w}-collection.png`, fullPage: true });
const sell = page.getByRole("button", { name: "Sell", exact: true }).first();
if (await sell.count()) {
  await sell.click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `shots/app-${w}-sell.png` });
}
console.log(errors.length ? errors.join("\n") : "no page errors");
await browser.close();
