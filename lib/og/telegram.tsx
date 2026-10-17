/**
 * Images for Telegram bot messages: the welcome lineup and one odds sheet per machine. Same frame and palette as
 * the share cards (lib/og/frame.tsx), drawn by app/api/og/tg/[kind]/route.tsx.
 */
import { MACHINES, fmtMultiplier, fmtPct, type Machine } from "@/lib/machines";
import { usdc } from "@/lib/stocks";
import { OgBox, OgFrame } from "./frame";
import { CLAW, CREAM, LINE, MUTED, PANEL, PRIZE } from "./palette";

export function TgWelcomeImage() {
  return (
    <OgFrame eyebrow="Claw machines on Arc" footer="Every box returns at least half">
      <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 76, fontWeight: 500, lineHeight: 1, letterSpacing: -2.7 }}>
            <span>Grab a box.</span>
            <span>Pull real stocks.</span>
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            {MACHINES.map((m, i) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "16px 22px",
                  borderRadius: 12,
                  backgroundColor: PANEL,
                  border: `1.5px solid ${i === 0 ? CLAW : LINE}`,
                }}
              >
                <span style={{ fontSize: 26 }}>{m.name}</span>
                <span style={{ fontFamily: "Geist Mono", fontSize: 22, color: MUTED }}>{usdc(m.priceUsdc)} USDC</span>
              </div>
            ))}
          </div>
        </div>
        <OgBox size={300} />
      </div>
    </OgFrame>
  );
}

export function TgOddsImage({ machine }: { machine: Machine }) {
  const top = Math.max(...machine.tiers.map((t) => t.probability));
  return (
    <OgFrame eyebrow={`${machine.name} odds`} footer={`${usdc(machine.priceUsdc)} USDC per play, ${fmtPct(machine.rtp)} expected return`}>
      <div style={{ display: "flex", flexDirection: "column", width: "100%", justifyContent: "center", gap: 12 }}>
        {machine.tiers.map((t) => (
          <div key={t.name} style={{ display: "flex", width: "100%", alignItems: "center", gap: 24, fontSize: 26 }}>
            <span style={{ display: "flex", width: 170, flexShrink: 0, color: t.multiplier >= 2 ? PRIZE : CREAM }}>{t.name}</span>
            <span style={{ display: "flex", width: 90, flexShrink: 0, fontFamily: "Geist Mono", color: MUTED }}>{fmtMultiplier(t.multiplier)}</span>
            <div style={{ display: "flex", flexGrow: 1, flexBasis: 0, minWidth: 0, height: 14, borderRadius: 7, backgroundColor: PANEL }}>
              <div style={{ width: `${Math.max(1.5, (t.probability / top) * 100)}%`, height: 14, borderRadius: 7, backgroundColor: CREAM }} />
            </div>
            <span style={{ display: "flex", justifyContent: "flex-end", width: 130, flexShrink: 0, fontFamily: "Geist Mono" }}>{fmtPct(t.probability, 2)}</span>
          </div>
        ))}
      </div>
    </OgFrame>
  );
}
