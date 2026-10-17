/**
 * Writes brand/logo/*.svg and app/icon.svg from lib/brand/logo.ts, the same source as components/Logo.tsx and the
 * share cards. Run: `pnpm brand` (after `node brand/wordmark.mjs` if the wordmark changed).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logoSvg } from "../lib/brand/logo.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "brand/logo");
mkdirSync(OUT, { recursive: true });

const files = {
  "mark.svg": logoSvg.mark("dark"),
  "mark-light.svg": logoSvg.mark("light"),
  "mark-mono.svg": logoSvg.mark("mono"),
  "wordmark.svg": logoSvg.wordmark("dark"),
  "wordmark-light.svg": logoSvg.wordmark("light"),
  "wordmark-mono.svg": logoSvg.wordmark("mono"),
  "lockup.svg": logoSvg.lockup("dark"),
  "lockup-light.svg": logoSvg.lockup("light"),
  "lockup-mono.svg": logoSvg.lockup("mono"),
  "tile.svg": logoSvg.tile(512),
};
for (const [name, svg] of Object.entries(files)) writeFileSync(join(OUT, name), `${svg}\n`);
writeFileSync(join(ROOT, "app/icon.svg"), `${logoSvg.tile(64)}\n`);
console.log(`wrote ${Object.keys(files).length} logo files and app/icon.svg`);
