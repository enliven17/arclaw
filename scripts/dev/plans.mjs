/** Writes shots/plan-<width>.json: every landing section, plus scrub points inside the pinned ones. */
import { writeFileSync, mkdirSync } from "node:fs";

mkdirSync("shots", { recursive: true });
const STEPS = [
  ["hero", "#main", 0],
  ["hero-scrub", "#main", 1100],
  ["machines", "#machines", 0],
  ["machines-cards", "#machines", 450],
  ["how", "#how", 0],
  ["how-box", "#how", 900],
  ["how-pack", "#how", 1700],
  ["how-cards", "#how", 2650],
  ["stocks", "#stocks", 0],
  ["gift", "#gift", 0],
  ["gift-form", "#gift", 500],
  ["odds", "#odds", 0],
  ["odds-table", "#odds", 450],
  ["odds-sim", "#odds", 1100],
  ["cta", "footer", 0],
  ["footer", "footer", 2000],
];
for (const w of [1440, 1280, 768, 390]) {
  const plan = STEPS.map(([n, to, offset]) => ({ out: `shots/w${w}-${n}.png`, to, offset, wait: 1500 }));
  writeFileSync(`shots/plan-${w}.json`, JSON.stringify(plan, null, 1));
}
console.log("plans written");
