"use client";

/**
 * Page transitions. Two kinds ride on the browser's View Transitions API, through React's <ViewTransition> (Next 16
 * App Router; no config):
 *
 *   page   app tabs and legal pages: the old page fades out quickly, the new one fades in with a small rise.
 *   morph  a cabinet keeps its view-transition name from the marketplace into its machine page (CabinetMorph).
 *
 * The third, between the landing and the app, is the claw curtain (ClawCurtain.tsx), started by a ClawLink; it
 * swaps the route under a black screen, so the view transition stays out of its way (the "claw" type is none).
 *
 * Reduced motion: no animation, the swap is instant (globals.css). Browsers without the API swap instantly too.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ViewTransition, type ComponentProps, type ReactNode } from "react";
import { runCurtain } from "@/lib/curtain";

/** The page boundary, around everything a route renders (one DOM node, so the page is one group). */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition update={{ claw: "none", default: "page-swap" }} default="none">
      <div className="vt-page">{children}</div>
    </ViewTransition>
  );
}

/** A link between the landing and the app: the claw curtain takes over the navigation. */
export function ClawLink({ href, onClick, children, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      prefetch={false}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (typeof Element.prototype.animate !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        e.preventDefault();
        if (!runCurtain(href)) router.push(href);
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
