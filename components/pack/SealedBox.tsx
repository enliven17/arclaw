/**
 * The sealed prize box seen front on, finished like the boxes inside its machine (components/claw PrizeBox):
 *   single  plain cardboard in warm greys, one strip of tape over the lid
 *   stack   printed: a cream band, the wordmark on the front
 *   vault   rigid and deep: a lid line, metal corner caps, a round seal with the mark
 *
 * Hooks: [data-box] root, [data-lid] the lid (it lifts in the open animation).
 */
import { CLAW, CREAM, MARK_BODY, MARK_PRONGS, MARK_SIZE, PRONG_W, WORD_PATH, WORD_SCALE } from "@/lib/brand/logo";
import { cn } from "@/lib/cn";
import type { Variant } from "@/components/claw/view";

const W = 200;
const H = 160;
const LID = 34;

const FINISH: Record<Variant, { body: string; lid: string; edge: string; side: string }> = {
  single: { body: "#25211c", lid: "#2d2822", edge: "rgba(236,230,218,0.16)", side: "#1d1a16" },
  stack: { body: "#1f1f25", lid: "#26262d", edge: "rgba(236,230,218,0.2)", side: "#18181d" },
  vault: { body: "#111114", lid: "#18181c", edge: "rgba(236,230,218,0.32)", side: "#0b0b0d" },
};

function Mark({ x, y, size }: { x: number; y: number; size: number }) {
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${size / MARK_SIZE})`}>
      <path d={MARK_BODY} fill={CREAM} />
      <path d={MARK_PRONGS} fill="none" stroke={CLAW} strokeWidth={PRONG_W} strokeLinejoin="miter" />
    </g>
  );
}

export function SealedBox({ variant, className }: { variant: Variant; className?: string }) {
  const f = FINISH[variant];
  const bodyTop = LID - 6;
  const word = WORD_SCALE * 0.42;
  return (
    <div data-box="" className={cn("relative aspect-[200/160]", className)} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible">
        {/* Body. */}
        <rect x="6" y={bodyTop} width={W - 12} height={H - bodyTop - 2} rx={variant === "vault" ? 6 : 4} fill={f.body} stroke={f.edge} />
        <rect x={W - 30} y={bodyTop} width="24" height={H - bodyTop - 2} fill={f.side} opacity="0.7" />
        {variant === "single" ? <path d={`M${W / 2 - 7} ${bodyTop}h14v26h-14z`} fill="#3a352d" /> : null}
        {variant === "stack" ? (
          <g>
            <path d={`M${W / 2 - 12} ${bodyTop}h24V${H - 2}h-24z`} fill={CREAM} fillOpacity="0.2" />
            <path d={WORD_PATH} fill={CREAM} fillOpacity="0.75" transform={`translate(${18} ${H - 30}) scale(${word})`} />
          </g>
        ) : null}
        {variant === "vault" ? (
          <g>
            <circle cx={W / 2} cy={(bodyTop + H) / 2 + 4} r="22" fill={CREAM} fillOpacity="0.9" />
            <circle cx={W / 2} cy={(bodyTop + H) / 2 + 4} r="17" fill="none" stroke="#111114" strokeOpacity="0.5" />
            <Mark x={W / 2} y={(bodyTop + H) / 2 + 4} size={22} />
            {[
              [8, H - 4],
              [W - 8, H - 4],
            ].map(([x, y]) => (
              <path key={x} d={`M${x! < W / 2 ? x : x! - 14} ${y}h14${x! < W / 2 ? "v-14" : "v-14"}`} stroke={CREAM} strokeOpacity="0.6" strokeWidth="3" fill="none" />
            ))}
          </g>
        ) : null}
      </svg>
      {/* Lid: its own svg so it can lift. */}
      <svg data-lid="" viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible" style={{ transformOrigin: "50% 20%" }}>
        <rect x="0" y="6" width={W} height={LID} rx={variant === "vault" ? 6 : 4} fill={f.lid} stroke={f.edge} />
        {variant === "single" ? <path d={`M${W / 2 - 7} 6h14v${LID}h-14z`} fill="#3a352d" /> : null}
        {variant === "stack" ? <path d={`M${W / 2 - 12} 6h24v${LID}h-24z`} fill={CREAM} fillOpacity="0.2" /> : null}
        {variant === "vault" ? (
          <g>
            <path d={`M4 ${LID - 2}H${W - 4}`} stroke={CREAM} strokeOpacity="0.25" />
            <path d="M0 20V8a2 2 0 0 1 2-2h12M186 6h12a2 2 0 0 1 2 2v12" stroke={CREAM} strokeOpacity="0.6" strokeWidth="3" fill="none" />
          </g>
        ) : null}
        {variant === "stack" ? <Mark x={W / 2} y={6 + LID / 2} size={16} /> : null}
      </svg>
    </div>
  );
}
