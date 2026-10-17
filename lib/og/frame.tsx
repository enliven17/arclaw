/**
 * The share-card frame every next/og image uses: a 1200x630 ink card, the lockup top-left, a mono eyebrow, the
 * body, and a footer row with the domain. Matte: no gradients, no glow, hairlines only, one accent.
 *
 * Satori rules: every element with more than one child needs display: flex; no grid; fonts from ogFonts().
 */
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
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Satori draws <img>, not next/image */}
          <img src={LOCKUP_URI} width={LOCKUP_W * 1.1} height={LOCKUP_H * 1.1} />
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

/** A stock card at 63:88, as Satori draws it. `foil` puts the prize hairline on it. */
export function OgCard({ card, width = 250, foil = false, rotate = 0, index = 0 }: { card: PullCard; width?: number; foil?: boolean; rotate?: number; index?: number }) {
  const height = Math.round((width * 88) / 63);
  const pad = Math.round(width * 0.09);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width,
        height,
        padding: pad,
        borderRadius: 14,
        backgroundColor: PANEL_2,
        border: `2px solid ${foil ? PRIZE : LINE}`,
        ...(rotate ? { transform: `rotate(${rotate}deg)` } : {}),
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "Geist Mono", fontSize: 15, letterSpacing: 1.5, color: MUTED }}>
        <span>{foil ? "FOIL" : "CARD"}</span>
        <span>{`0${index + 1}/03`}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontFamily: "Geist Mono", fontSize: Math.round(width * 0.24), letterSpacing: -3, lineHeight: 1, color: CREAM }}>{card.ticker}</span>
        <span style={{ marginTop: 10, fontSize: 18, color: MUTED }}>{card.name}</span>
      </div>
      <div style={{ display: "flex", paddingTop: 14, borderTop: `1px solid ${LINE}`, fontFamily: "Geist Mono", fontSize: 17, color: CREAM }}>
        {`${usdc(card.amount)} USDC of ${card.ticker}`}
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
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={MARK_URI} width={size * 0.22} height={size * 0.22} />
      </div>
    </div>
  );
}

export { CLAW };
