/**
 * The booster pack: a sealed foil pouch, drawn in SVG so every edge stays crisp. Used by the landing's How it works
 * and by the app's reveal, so they cannot drift.
 *
 *   seals      serrated top and bottom edges with crimp ridges across them
 *   body       pillow shading as flat tone steps (inset bands), a specular sheen as two flat translucent bands,
 *              never a gradient or a glow
 *   print      the arclaw mark and wordmark (lib/brand), the machine name and the card count in mono
 *   tear strip a perforated line under the top seal with a notch on the left; the strip is its own element
 *              ([data-pack-strip]) so the tear can rip it off along the perforation and curl it away
 *
 * Hooks for animation: [data-pack] root, [data-pack-strip] the top piece, [data-pack-body] the rest.
 */
import { CLAW, CREAM, MARK_BODY, MARK_PRONGS, MARK_SIZE, PRONG_W, WORD_PATH, WORD_SCALE } from "@/lib/brand/logo";
import { cn } from "@/lib/cn";

const W = 200;
const H = 320;
const TEAR_Y = 40; // the perforation: strip above, body below
const SEAL = 22; // top and bottom seal depth
const TEETH = 22;

/** Serrated edge along y = `y`, teeth pointing `dir` (-1 up, 1 down), as a list of points left to right. */
function serrate(y: number, dir: -1 | 1): string {
  const pts: string[] = [];
  for (let i = 0; i <= TEETH * 2; i++) pts.push(`${((i / (TEETH * 2)) * W).toFixed(2)} ${(y + (i % 2 ? dir * 4.5 : 0)).toFixed(2)}`);
  return pts.join(" L ");
}

/** A slightly irregular line along the perforation: the torn edge both pieces share. */
const TEAR = (() => {
  const pts: string[] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * W;
    const jitter = [0, 0.9, -0.6, 1.2, -1, 0.4, -0.8, 1, -0.3, 0.7][i % 10]!;
    pts.push(`${x.toFixed(2)} ${(TEAR_Y + jitter).toFixed(2)}`);
  }
  return pts;
})();
const tearLR = TEAR.join(" L ");
const tearRL = [...TEAR].reverse().join(" L ");

const STRIP_PATH = `M ${serrate(4.5, -1)} L ${tearRL} Z`;
const BODY_PATH = `M ${tearLR} L ${serrate(H - 4.5, 1).split(" L ").reverse().join(" L ")} Z`;

/** Crimp ridges across a seal band, edge to edge. */
const ridges = (y0: number, y1: number) =>
  Array.from({ length: 4 }, (_, i) => {
    const y = y0 + ((i + 1) * (y1 - y0)) / 5;
    return `M0 ${y.toFixed(1)}H${W}`;
  }).join("");

/** Perforation: short dashes along the tear line, ending on both edges. */
const PERF = Array.from({ length: 33 }, (_, i) => {
  const x = 3 + i * 5.94;
  return `M${x.toFixed(1)} ${TEAR_Y}h2.6`;
}).join("");

/** `uid` keeps the clip ids unique when more than one pack is on a page. */
export function BoosterPack({ machine, cards = 3, className, uid = "pack" }: { machine: string; cards?: number; className?: string; uid?: string }) {
  const wordW = 290.8 * WORD_SCALE;
  return (
    <div data-pack="" className={cn("relative aspect-[200/320]", className)} aria-hidden="true">
      {/* Body: everything below the perforation. */}
      <svg data-pack-body="" viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <clipPath id={`${uid}-body`}>
            <path d={BODY_PATH} />
          </clipPath>
        </defs>
        <path d={BODY_PATH} fill="#1b1b20" />
        <g clipPath={`url(#${uid}-body)`}>
          {/* Pillow: stepped inset bands, each a touch lighter toward the middle. */}
          <rect x="7" y={TEAR_Y + 6} width={W - 14} height={H - TEAR_Y - SEAL - 12} rx="14" fill="#1f1f25" />
          <rect x="15" y={TEAR_Y + 14} width={W - 30} height={H - TEAR_Y - SEAL - 28} rx="12" fill="#222229" />
          <rect x="24" y={TEAR_Y + 24} width={W - 48} height={H - TEAR_Y - SEAL - 48} rx="10" fill="#25252c" />
          {/* Sheen: two flat translucent bands on the diagonal. */}
          <path d={`M ${W * 0.56} ${TEAR_Y} L ${W * 0.74} ${TEAR_Y} L ${W * 0.22} ${H} L ${W * 0.04} ${H} Z`} fill={CREAM} fillOpacity="0.045" />
          <path d={`M ${W * 0.78} ${TEAR_Y} L ${W * 0.84} ${TEAR_Y} L ${W * 0.32} ${H} L ${W * 0.26} ${H} Z`} fill={CREAM} fillOpacity="0.07" />
          {/* Bottom seal with crimp ridges. */}
          <rect x="0" y={H - SEAL} width={W} height={SEAL} fill="#16161a" />
          <path d={ridges(H - SEAL, H)} stroke={CREAM} strokeOpacity="0.07" strokeWidth="0.8" />
          <path d={`M0 ${H - SEAL}H${W}`} stroke={CREAM} strokeOpacity="0.1" strokeWidth="0.8" />
          {/* Print: mark, wordmark, machine and count. */}
          <g transform={`translate(${W / 2 - 22} 112) scale(${44 / MARK_SIZE})`}>
            <path d={MARK_BODY} fill={CREAM} />
            <path d={MARK_PRONGS} fill="none" stroke={CLAW} strokeWidth={PRONG_W} strokeLinejoin="miter" />
          </g>
          <path d={WORD_PATH} fill={CREAM} transform={`translate(${(W - wordW * 0.9) / 2} 172) scale(${WORD_SCALE * 0.9})`} />
          <text x={W / 2} y="232" textAnchor="middle" fill={CREAM} fillOpacity="0.62" fontSize="10" letterSpacing="2" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
            {machine.toUpperCase()}
          </text>
          <text x={W / 2} y="268" textAnchor="middle" fill={CREAM} fillOpacity="0.42" fontSize="8.5" letterSpacing="1.5" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
            {cards} CARDS INSIDE
          </text>
          <rect x="24" y="250" width={W - 48} height="0.8" fill={CREAM} fillOpacity="0.1" />
        </g>
        <path d={BODY_PATH} fill="none" stroke={CREAM} strokeOpacity="0.16" strokeWidth="1" />
      </svg>

      {/* Strip: the top seal and the tear strip, its own piece so it can rip off. */}
      <svg data-pack-strip="" viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full overflow-visible" style={{ transformOrigin: "100% 12.5%" }}>
        <defs>
          <clipPath id={`${uid}-strip`}>
            <path d={STRIP_PATH} />
          </clipPath>
        </defs>
        <path d={STRIP_PATH} fill="#16161a" />
        <g clipPath={`url(#${uid}-strip)`}>
          <path d={ridges(0, SEAL)} stroke={CREAM} strokeOpacity="0.07" strokeWidth="0.8" />
          <path d={`M0 ${SEAL}H${W}`} stroke={CREAM} strokeOpacity="0.1" strokeWidth="0.8" />
          <rect x="0" y={SEAL} width={W} height={TEAR_Y - SEAL} fill="#1d1d22" />
          <text x={W / 2} y={SEAL + 12} textAnchor="middle" fill={CREAM} fillOpacity="0.45" fontSize="7" letterSpacing="1.6" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
            TEAR TO OPEN
          </text>
        </g>
        {/* Tear notch on the left edge, at the perforation. */}
        <path d={`M0 ${TEAR_Y - 3.5} L5 ${TEAR_Y} L0 ${TEAR_Y + 3.5} Z`} fill="#0c0c0e" />
        <path d={PERF} stroke={CREAM} strokeOpacity="0.35" strokeWidth="0.9" />
        <path d={STRIP_PATH} fill="none" stroke={CREAM} strokeOpacity="0.16" strokeWidth="1" />
      </svg>
    </div>
  );
}

export const PACK_TEAR_RATIO = TEAR_Y / H;
