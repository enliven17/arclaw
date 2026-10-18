/**
 * The share-card frame every next/og image uses: a 1200x630 ink card, the lockup top-left, a mono eyebrow, the
 * body, and a footer row with the domain. Matte: no gradients, no glow, hairlines only, one accent.
 *
 * Satori rules: every element with more than one child needs display: flex; no grid; fonts from ogFonts().
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { LOCKUP_H, LOCKUP_W, logoSvg } from "@/lib/brand/logo";
import { usdc, type PullCard } from "@/lib/stocks";
import { CLAW, CREAM, INK, LINE, MUTED, PANEL, PANEL_2, PRIZE } from "./palette";

export const OG_SIZE = { width: 1200, height: 630 } as const;

const uri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const LOCKUP_URI = uri(logoSvg.lockup("dark"));
const MARK_URI = uri(logoSvg.mark("dark"));

export function OgFrame({ eyebrow, children, footer }: { eyebrow: string; children: ReactNode; footer: string }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: INK, color: CREAM, fontFamily: "Geist" }}>
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, padding: "52px 64px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws <img>, not next/image */}
          <img src={LOCKUP_URI} alt="arclaw" width={LOCKUP_W * 1.1} height={LOCKUP_H * 1.1} />
          <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: 20, letterSpacing: 2, color: MUTED }}>{eyebrow.toUpperCase()}</div>
        </div>
        <div style={{ display: "flex", flexGrow: 1 }}>{children}</div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 76,
          margin: "0 64px",
          borderTop: `1px solid ${LINE}`,
          fontSize: 22,
          color: MUTED,
        }}
      >
        <span>{footer}</span>
        <span style={{ fontFamily: "Geist Mono", color: CREAM }}>arclaw.app</span>
      </div>
    </div>
  );
}

/** A stock logo from public/logos as a data URI (read once per ticker), or null when there is none. */
const logoCache = new Map<string, string | null>();
function logoUri(ticker: string): string | null {
  if (!logoCache.has(ticker)) {
    const file = join(process.cwd(), "public/logos", `${ticker}.svg`);
    logoCache.set(ticker, /^[A-Z]{1,6}$/.test(ticker) && existsSync(file) ? uri(readFileSync(file, "utf8")) : null);
  }
  return logoCache.get(ticker)!;
}

/**
 * The stock card at 63:88, mirroring components/landing/StockCard.tsx: ticker and tier on top, a framed logo
 * window in the centre, company and amount at the bottom. Sizes scale from the 210px reference.
 */
export function OgCard({ card, tier, width = 210, rotate = 0 }: { card: PullCard; tier: string; width?: number; rotate?: number }) {
  const k = width / 210;
  const height = Math.round((width * 88) / 63);
  const logo = logoUri(card.ticker);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width,
        height,
        padding: `${18 * k}px ${20 * k}px`,
        borderRadius: 14,
        backgroundColor: PANEL,
        border: `1.5px solid ${LINE}`,
        ...(rotate ? { transform: `rotate(${rotate}deg)` } : {}),
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: "Geist Mono", fontSize: 18 * k, color: CREAM }}>{card.ticker}</span>
        <span style={{ fontSize: 13 * k, color: PRIZE }}>{tier}</span>
      </div>
      <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center", margin: `${10 * k}px 0`, borderRadius: 10, border: `1.5px solid ${LINE}` }}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={`${card.name} logo`} width={96 * k} height={96 * k} />
        ) : (
          <span style={{ fontFamily: "Geist Mono", fontSize: 40 * k, color: CREAM }}>{card.ticker}</span>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 15 * k, color: MUTED, maxWidth: width * 0.42, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.name}</span>
        <span style={{ fontFamily: "Geist Mono", fontSize: 16 * k, color: CREAM, whiteSpace: "nowrap" }}>{`${usdc(card.amount)} USDC`}</span>
      </div>
    </div>
  );
}

/** A sealed prize box seen front on: panel, a tape band, the mark on the seal. */
export function OgBox({ size = 300 }: { size?: number }) {
  return (
    <div style={{ display: "flex", position: "relative", width: size, height: size, borderRadius: 18, backgroundColor: PANEL, border: `2px solid ${LINE}` }}>
      <div style={{ position: "absolute", left: size * 0.41, top: 0, width: size * 0.18, height: size - 4, backgroundColor: "rgba(236,230,218,0.08)" }} />
      <div
        style={{
          position: "absolute",
          left: size * 0.32,
          top: size * 0.32,
          width: size * 0.36,
          height: size * 0.36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 10,
          backgroundColor: PANEL_2,
          border: `2px solid ${LINE}`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MARK_URI} alt="arclaw mark" width={size * 0.22} height={size * 0.22} />
      </div>
    </div>
  );
}

export { CLAW };
