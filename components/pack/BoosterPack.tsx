/**
 * The booster pack: a thin foil wrapper, drawn in SVG. One component for the landing's How it works and the app's
 * reveal, so they cannot drift.
 *
 *   wrapper    a pillow: the long sides bow out a little; crimped, serrated seals top and bottom with vertical
 *              crimp ribs
 *   foil       a dark metallic base, a fine noise texture (feTurbulence, low alpha) for the crinkled plastic,
 *              crinkle highlights as thin broken strokes, and specular streaks as flat translucent cream shapes
 *              (the one sanctioned shine; no coloured halos, no gradients)
 *   print      the arclaw mark large, the wordmark, the machine name set large, and a rarity band of six pips
 *              (one per tier; the drawn tier fills once known). No small caps labels.
 *   tear       a notch on the left of the top seal is the only hint. The strip above the perforation is its own
 *              element with a jagged bottom edge that matches the body's, so the rip reads as torn plastic
 *
 * Animation hooks: [data-pack] root, [data-pack-strip] top strip, [data-pack-body] the rest.
 * PACK_OPEN_AT and PACK_SEAL_AT give the torn top and the bottom seal as shares of the height, for clipping cards.
 */
import { CLAW, CREAM, MARK_BODY, MARK_PRONGS, MARK_SIZE, PRONG_W, WORD_PATH, WORD_SCALE, WORD_W } from "@/lib/brand/logo";
import { cn } from "@/lib/cn";

const W = 200;
const H = 330;
const TEAR_Y = 44; // perforation line
const SEAL = 24; // seal depth top and bottom
const TEETH = 24;
const BOW = 5; // how far the long sides bow out at mid height

/** Serrated edge along y, left to right; teeth point up (dir -1) or down (1). */
function serrate(y: number, dir: -1 | 1): string[] {
  const pts: string[] = [];
  for (let i = 0; i <= TEETH * 2; i++) pts.push(`${((i / (TEETH * 2)) * W).toFixed(2)} ${(y + (i % 2 ? dir * 4 : 0)).toFixed(2)}`);
  return pts;
}

/** The jagged tear: an irregular zigzag both pieces share, so the rip looks torn rather than cut. */
const TEAR: string[] = (() => {
  const n = 46;
  const jitter = [0, 2.2, -1.4, 2.8, -2.1, 1.1, -2.6, 2, -0.8, 1.6, -1.9, 2.5];
  return Array.from({ length: n + 1 }, (_, i) => `${((i / n) * W).toFixed(2)} ${(TEAR_Y + jitter[i % jitter.length]!).toFixed(2)}`);
})();

const TOP_EDGE = serrate(4, -1);
const BOTTOM_EDGE = serrate(H - 4, 1).reverse();
const BODY_PATH = `M ${TEAR.join(" L ")} Q ${W + BOW} ${H / 2} ${W} ${H - SEAL} L ${BOTTOM_EDGE.join(" L ")} L 0 ${H - SEAL} Q ${-BOW} ${H / 2} ${TEAR[0]} Z`;
const STRIP_PATH = `M ${TOP_EDGE.join(" L ")} L ${[...TEAR].reverse().join(" L ")} Z`;

/** Vertical crimp ribs across a seal band. */
const ribs = (y0: number, y1: number) => Array.from({ length: 48 }, (_, i) => `M${(2 + i * 4.1).toFixed(1)} ${y0}V${y1}`).join("");

/** Crinkles: short broken strokes that catch the light. */
const CRINKLES = "M18 64l9 6l7-3l10 8M150 58l8 9l11 2M172 120l-6 14l5 9M22 214l8-5l6 9l9-3M150 270l10-6l8 7M40 288l12-4l9 5M178 200l-7 10M30 140l5 12l-3 10";

export function BoosterPack({
  machine,
  tiers = 6,
  tier,
  className,
  uid = "pack",
}: {
  machine: string;
  /** Pips in the rarity band, one per tier. */
  tiers?: number;
  /** The drawn tier's rank (0 = most common), once known: its pip fills. */
  tier?: number;
  className?: string;
  /** Keeps the svg ids unique when more than one pack is on a page. */
  uid?: string;
}) {
  const word = WORD_SCALE * 0.95;
  const pip = 9;
  const gap = 7;
  const pipsW = tiers * pip + (tiers - 1) * gap;
  return (
    <div data-pack="" className={cn("relative aspect-[200/330]", className)} aria-hidden="true">
      <svg data-pack-body="" viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible" style={{ transformOrigin: "50% 13%" }}>
        <defs>
          <clipPath id={`${uid}-body`}>
            <path d={BODY_PATH} />
          </clipPath>
          <filter id={`${uid}-noise`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.93  0 0 0 0 0.9  0 0 0 0 0.85  0 0 0 0.55 -0.2" />
          </filter>
        </defs>
        <path d={BODY_PATH} fill="#1a1a1f" />
        <g clipPath={`url(#${uid}-body)`}>
          {/* Pillow: the middle sits a step lighter than the edges. */}
          <rect x="10" y={TEAR_Y + 10} width={W - 20} height={H - TEAR_Y - SEAL - 20} rx="18" fill="#1e1e24" />
          <rect x="22" y={TEAR_Y + 22} width={W - 44} height={H - TEAR_Y - SEAL - 44} rx="14" fill="#222229" />
          {/* Foil texture. */}
          <rect x="0" y="0" width={W} height={H} filter={`url(#${uid}-noise)`} opacity="0.16" />
          {/* Print: mark, wordmark, the machine name set large, the rarity band. */}
          <g transform={`translate(${W / 2 - 32} 80) scale(${64 / MARK_SIZE})`}>
            <path d={MARK_BODY} fill={CREAM} />
            <path d={MARK_PRONGS} fill="none" stroke={CLAW} strokeWidth={PRONG_W} strokeLinejoin="miter" />
          </g>
          <path d={WORD_PATH} fill={CREAM} transform={`translate(${(W - WORD_W * word) / 2} 160) scale(${word})`} />
          <text x={W / 2} y="232" textAnchor="middle" fill={CREAM} fillOpacity="0.85" fontSize="26" letterSpacing="-0.6" style={{ fontFamily: "var(--font-geist), sans-serif", fontWeight: 500 }}>
            {machine}
          </text>
          <rect x="0" y="250" width={W} height="26" fill={CREAM} fillOpacity="0.07" />
          {Array.from({ length: tiers }, (_, i) => (
            <rect
              key={i}
              x={(W - pipsW) / 2 + i * (pip + gap)}
              y={258.5}
              width={pip}
              height={pip}
              rx="2"
              fill={tier === i ? "#E9C46A" : CREAM}
              fillOpacity={tier === i ? 1 : 0.22 + i * 0.06}
            />
          ))}
          {/* Specular streaks: the sanctioned shine, flat translucent shapes on the bulge. */}
          <path d={`M ${W * 0.62} ${TEAR_Y} L ${W * 0.8} ${TEAR_Y} L ${W * 0.3} ${H} L ${W * 0.12} ${H} Z`} fill={CREAM} fillOpacity="0.07" />
          <path d={`M ${W * 0.84} ${TEAR_Y} L ${W * 0.9} ${TEAR_Y} L ${W * 0.4} ${H} L ${W * 0.34} ${H} Z`} fill={CREAM} fillOpacity="0.13" />
          <path d={`M 6 ${TEAR_Y + 30} Q 2 ${H / 2} 6 ${H - SEAL - 30}`} stroke={CREAM} strokeOpacity="0.28" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <path d={CRINKLES} stroke={CREAM} strokeOpacity="0.2" strokeWidth="0.9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          {/* Bottom seal: crimp ribs. */}
          <rect x="0" y={H - SEAL} width={W} height={SEAL} fill="#141418" />
          <path d={ribs(H - SEAL, H)} stroke={CREAM} strokeOpacity="0.09" strokeWidth="1" />
          <path d={`M0 ${H - SEAL}H${W}`} stroke={CREAM} strokeOpacity="0.14" strokeWidth="0.8" />
        </g>
        <path d={BODY_PATH} fill="none" stroke={CREAM} strokeOpacity="0.18" strokeWidth="1" />
      </svg>

      <svg data-pack-strip="" viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible" style={{ transformOrigin: "96% 12%" }}>
        <defs>
          <clipPath id={`${uid}-strip`}>
            <path d={STRIP_PATH} />
          </clipPath>
        </defs>
        <path d={STRIP_PATH} fill="#141418" />
        <g clipPath={`url(#${uid}-strip)`}>
          <path d={ribs(0, SEAL)} stroke={CREAM} strokeOpacity="0.09" strokeWidth="1" />
          <path d={`M0 ${SEAL}H${W}`} stroke={CREAM} strokeOpacity="0.14" strokeWidth="0.8" />
          <rect x="0" y={SEAL} width={W} height={TEAR_Y - SEAL + 4} fill="#1a1a1f" />
          <rect x="0" y="0" width={W} height={TEAR_Y + 4} filter={`url(#${uid}-noise)`} opacity="0.16" />
          <path d={`M ${W * 0.7} 0 L ${W * 0.76} 0 L ${W * 0.7} ${TEAR_Y + 4} L ${W * 0.64} ${TEAR_Y + 4} Z`} fill={CREAM} fillOpacity="0.1" />
        </g>
        {/* The notch: the only tear hint. */}
        <path d={`M-0.5 ${TEAR_Y - 5} L7 ${TEAR_Y} L-0.5 ${TEAR_Y + 5} Z`} fill="#0c0c0e" />
        <path d={STRIP_PATH} fill="none" stroke={CREAM} strokeOpacity="0.18" strokeWidth="1" />
      </svg>
    </div>
  );
}

/** The torn top and the bottom seal, as shares of the pack's height. */
export const PACK_OPEN_AT = TEAR_Y / H;
export const PACK_SEAL_AT = (H - SEAL) / H;
