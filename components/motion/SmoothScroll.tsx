"use client";

/**
 * One Lenis on GSAP's ticker (lib/motion.ts), ScrollTrigger reads it. Ported from snipadfun's SmoothScroll:
 * back to top on route change, and `<Reveals />` mounted last in a page wires the data-attribute reveals.
 * Reduced motion: native scroll, no reveals (CSS shows everything), no split text.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { REDUCED, ScrollTrigger, gsap, scrollToTop, startSmoothScroll, stopSmoothScroll } from "@/lib/motion";

export function SmoothScroll({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    startSmoothScroll();
    const query = window.matchMedia(REDUCED);
    const onChange = () => (query.matches ? stopSmoothScroll() : startSmoothScroll());
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
      stopSmoothScroll();
    };
  }, []);

  useEffect(() => {
    if (first.current) first.current = false;
    else scrollToTop();
  }, [pathname]);

  return <>{children}</>;
}

const fmt = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Mount last inside a page, so every section's own timelines and pins exist first.
 *
 *   [data-reveal]          fades up as it enters, in batches
 *   [data-split]           headline lines rise out of their mask on load; [data-split="scroll"] when it enters
 *   [data-count]           a number counts up from zero; the server renders the final value for no-JS
 */
export function Reveals() {
  useEffect(() => {
    if (matchMedia(REDUCED).matches) return;
    const ctx = gsap.context(() => {
      const els = gsap.utils.toArray<HTMLElement>("[data-reveal]");
      gsap.set(els, { opacity: 0, y: 24 });
      ScrollTrigger.batch(els, {
        start: "top 92%",
        once: true,
        onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.9, ease: "power3.out", stagger: 0.08, overwrite: true }),
      });

      gsap.utils.toArray<HTMLElement>("[data-split]").forEach((el) => {
        const onScroll = el.dataset.split === "scroll";
        gsap.fromTo(
          el.querySelectorAll(".split-line > span"),
          // y: 0 clears the pixel offset GSAP parses from the CSS start state (translateY(110%)).
          { yPercent: 110, y: 0 },
          {
            yPercent: 0,
            duration: 1.1,
            ease: "power4.out",
            stagger: 0.08,
            // On a first visit the splash covers the page for about two seconds; rise as it lifts.
            delay: onScroll ? 0 : document.documentElement.classList.contains("splashing") ? 1.9 : 0.15,
            scrollTrigger: onScroll ? { trigger: el, start: "top 88%", once: true } : undefined,
          },
        );
      });

      gsap.utils.toArray<HTMLElement>("[data-count]").forEach((el) => {
        const to = Number(el.dataset.count);
        const d = Number(el.dataset.decimals ?? 0);
        const out = el.querySelector<HTMLElement>("[data-count-out]") ?? el;
        if (!Number.isFinite(to)) return;
        const pre = el.dataset.prefix ?? "";
        const suf = el.dataset.suffix ?? "";
        const v = { n: 0 };
        out.textContent = `${pre}${fmt(0, d)}${suf}`;
        gsap.to(v, {
          n: to,
          duration: 1.4,
          ease: "power3.out",
          onUpdate: () => {
            out.textContent = `${pre}${fmt(v.n, d)}${suf}`;
          },
          scrollTrigger: { trigger: el, start: "top 95%", once: true },
        });
      });
    });
    ScrollTrigger.refresh();
    let live = true;
    document.fonts?.ready.then(() => live && ScrollTrigger.refresh());
    return () => {
      live = false;
      ctx.revert();
    };
  }, []);
  return null;
}

/** Headline whose lines rise in. Lines are passed explicitly so wrapping is designed, not measured. */
export function SplitHeading({
  lines,
  as: Tag = "h2",
  className = "",
  onScroll = false,
  id,
}: {
  lines: ReactNode[];
  as?: "h1" | "h2" | "h3";
  className?: string;
  onScroll?: boolean;
  id?: string;
}) {
  return (
    <Tag id={id} data-split={onScroll ? "scroll" : ""} className={className}>
      {lines.map((line, i) => (
        <span key={i} className="split-line block overflow-hidden pb-[0.08em]">
          <span className="block">{line}</span>
        </span>
      ))}
    </Tag>
  );
}
