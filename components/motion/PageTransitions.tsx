"use client";

/**
 * Page transitions on the browser's View Transitions API, through React's <ViewTransition> (Next 16 App Router; no
 * config). Three kinds:
 *
 *   claw   landing to app and back (ClawLink): the claw drops and grips the top edge of the page, then the page is
 *          hauled up and off while the new one waits underneath. Transforms only, about 650 ms.
 *   page   everything else (app tabs, legal pages): the old page fades out quickly, the new one fades in with a
 *          small rise.
 *   morph  a cabinet keeps its view-transition name from the marketplace into its machine page (CabinetMorph).
 *
 * Reduced motion: no animation, the swap is instant (globals.css). Browsers without the API swap instantly too.
 */
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { ViewTransition, useEffect, type ComponentProps, type ReactNode } from "react";
import { MARK_BODY, MARK_PRONGS, MARK_SIZE, PRONG_W } from "@/lib/brand/logo";
import { play } from "@/lib/sfx";

/**
 * The page boundary, around everything a route renders (one DOM node, so the page is one group). For the claw it
 * stays unnamed: the whole viewport is then the root snapshot, which the claw hauls up (globals.css).
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition update={{ claw: "none", default: "page-swap" }} default="none">
      <div className="vt-page">{children}</div>
    </ViewTransition>
  );
}

/**
 * The claw that hauls the page. It sits above the top edge until a ClawLink sets html[data-claw], then drops to grip
 * the page. It has its own view-transition name, so during the haul it rises with the old page (globals.css).
 */
export function TransitionClaw() {
  const path = usePathname();
  useEffect(() => {
    // The new page is in: put the claw away for next time.
    delete document.documentElement.dataset.claw;
  }, [path]);
  return (
    <div className="transition-claw" aria-hidden="true">
      <div className="transition-claw-cable" />
      <svg viewBox={`0 1 ${MARK_SIZE} 23`} width={MARK_SIZE * 3} height={23 * 3}>
        <path fill="var(--color-cream)" d={MARK_BODY} />
        <path fill="none" stroke="var(--color-claw)" strokeWidth={PRONG_W} strokeLinejoin="miter" d={MARK_PRONGS} />
      </svg>
    </div>
  );
}

const DROP_MS = 200;

/** A link between the landing and the app: the claw drops, grips, and the navigation hauls the page away. */
export function ClawLink({ href, onClick, children, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (!("startViewTransition" in document) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        e.preventDefault();
        document.documentElement.dataset.claw = "grip";
        play("drop");
        window.setTimeout(() => {
          play("motor");
          router.push(href, { transitionTypes: ["claw"] });
        }, DROP_MS);
      }}
    >
      {children}
    </Link>
  );
}

/** A machine cabinet that morphs between the marketplace card and its machine page. */
export function CabinetMorph({ slug, children }: { slug: string; children: ReactNode }) {
  return (
    <ViewTransition name={`cabinet-${slug}`} share="cabinet-morph" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
