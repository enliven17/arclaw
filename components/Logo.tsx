/**
 * The arclaw logo as inline SVG, built from lib/brand/logo.ts: the same paths as brand/logo/*.svg and the share
 * cards, so they cannot drift. Decorative by default; pass `title` when the logo is the only label.
 */
import { LOCKUP, LOCKUP_H, LOCKUP_W, MARK_BODY, MARK_PRONGS, MARK_SIZE, PRONG_W, WORD_H, WORD_PATH, WORD_W } from "@/lib/brand/logo";
import { cn } from "@/lib/cn";

type Variant = "lockup" | "mark" | "wordmark";

function MarkPaths({ mono }: { mono: boolean }) {
  return (
    <>
      <path fill={mono ? "currentColor" : "var(--color-cream)"} d={MARK_BODY} />
      <path
        fill="none"
        stroke={mono ? "currentColor" : "var(--color-claw)"}
        strokeWidth={PRONG_W}
        strokeLinecap="butt"
        strokeLinejoin="miter"
        d={MARK_PRONGS}
      />
    </>
  );
}

export function Logo({
  variant = "lockup",
  height = 28,
  mono = false,
  title,
  className,
}: {
  variant?: Variant;
  /** Rendered height in px. */
  height?: number;
  mono?: boolean;
  title?: string;
  className?: string;
}) {
  const box = variant === "mark" ? [MARK_SIZE, MARK_SIZE] : variant === "wordmark" ? [WORD_W, WORD_H] : [LOCKUP_W, LOCKUP_H];
  const word = mono ? "currentColor" : "var(--color-cream)";
  return (
    <svg
      viewBox={`0 0 ${box[0]} ${box[1]}`}
      height={height}
      width={(height * box[0]) / box[1]}
      className={cn("block shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {variant === "mark" ? <MarkPaths mono={mono} /> : null}
      {variant === "wordmark" ? <path fill={word} d={WORD_PATH} /> : null}
      {variant === "lockup" ? (
        <>
          <g transform={`scale(${LOCKUP.mark / MARK_SIZE})`}>
            <MarkPaths mono={mono} />
          </g>
          <path fill={word} transform={`translate(${LOCKUP.mark + LOCKUP.gap} ${LOCKUP.wordY}) scale(${LOCKUP.wordScale})`} d={WORD_PATH} />
        </>
      ) : null}
    </svg>
  );
}
