import localFont from "next/font/local";

/**
 * arclaw type (DESIGN.md):
 * - Geist 400/500: display and body. var --font-geist
 * - Geist Mono: money, tickers, addresses. tabular-nums. var --font-geist-mono
 * - Geist Pixel Square: small caps UI labels. var --font-geist-pixel
 *
 * Loaded from the geist package's files instead of `geist/font`, which declares every weight and all five pixel
 * faces and makes next/font preload each of them. Only the sans face is preloaded; mono and pixel load on first use.
 */
export const fontSans = localFont({
  src: [
    { path: "../node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2", weight: "400", style: "normal" },
    { path: "../node_modules/geist/dist/fonts/geist-sans/Geist-Medium.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-geist",
  display: "swap",
  fallback: ["system-ui", "Segoe UI", "Helvetica", "Arial", "sans-serif"],
});

export const fontMono = localFont({
  src: "../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
  display: "swap",
  preload: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
  adjustFontFallback: false,
});

export const fontPixel = localFont({
  src: "../node_modules/geist/dist/fonts/geist-pixel/GeistPixel-Square.woff2",
  weight: "500",
  variable: "--font-geist-pixel",
  display: "swap",
  preload: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
  adjustFontFallback: false,
});

export const fontVariables = [fontSans.variable, fontMono.variable, fontPixel.variable].join(" ");
