/**
 * Fonts for next/og (Satori reads TTF/OTF/WOFF, not WOFF2). Read once per process; next.config.ts traces
 * lib/og/fonts into every route that renders a card. Licence: lib/og/fonts/Geist-OFL.txt (SIL OFL 1.1).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type OgFont = { name: string; data: ArrayBuffer; weight?: 400 | 500; style?: "normal" };

const toArrayBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

let fonts: Promise<OgFont[]> | null = null;

function load(): Promise<OgFont[]> {
  const dir = join(process.cwd(), "lib/og/fonts");
  return Promise.all([
    readFile(join(dir, "Geist-Regular.ttf")),
    readFile(join(dir, "Geist-Medium.ttf")),
    readFile(join(dir, "GeistMono-Regular.ttf")),
  ]).then(([regular, medium, mono]) => [
    { name: "Geist", data: toArrayBuffer(regular), weight: 400, style: "normal" },
    { name: "Geist", data: toArrayBuffer(medium), weight: 500, style: "normal" },
    { name: "Geist Mono", data: toArrayBuffer(mono), weight: 400, style: "normal" },
  ]);
}

/** "Geist" (400, 500) and "Geist Mono" (400). A failed read is retried on the next call. */
export async function ogFonts(): Promise<OgFont[]> {
  fonts ??= load().catch((err: unknown) => {
    fonts = null;
    throw err;
  });
  return fonts;
}
