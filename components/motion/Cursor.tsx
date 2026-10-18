"use client";

/**
 * The custom cursor: a small cream dot on a light lerp. Over links, buttons and cards it grows into a ring; over a
 * machine it becomes a tiny claw (lib/brand/logo.ts) with its prongs open, which close while the button is held.
 * Fine pointers only, never under reduced motion. Text fields keep the native cursor; focus outlines are untouched
 * (keyboard focus never moves this). Position uses gsap.quickTo; the mode is a data attribute and CSS does the rest.
 */
import { useEffect, useRef } from "react";
import { gsap } from "@/lib/motion";
import { CLAW, CREAM, MARK_BODY, MARK_SIZE, PRONG_W } from "@/lib/brand/logo";

const QUERY = "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";
const INTERACTIVE = "a, button, [role='button'], [role='radio'], [role='tab'], label, select, summary, [data-card], [data-cursor='ring']";
const TEXT = "input:not([type='range']):not([type='checkbox']):not([type='radio']), textarea, [contenteditable='true']";
const MACHINE = ".claw-fig, [data-cursor='claw']";

// The mark's prongs, split so the outer two can swing shut.
const LEFT = "M9 10.5L4.6 15V18.6L8.2 22";
const RIGHT = "M15 10.5L19.4 15V18.6L15.8 22";
const MID = "M12 10.5V20";

export function Cursor() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    const query = window.matchMedia(QUERY);
    if (!el || !query.matches) return;
    const html = document.documentElement;
    html.classList.add("has-cursor");
    const x = gsap.quickTo(el, "x", { duration: 0.18, ease: "power3.out" });
    const y = gsap.quickTo(el, "y", { duration: 0.18, ease: "power3.out" });
    let mode = "";
    const setMode = (m: string) => {
      if (m !== mode) el.dataset.mode = mode = m;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      // Moving the node in the DOM (React reordering siblings) closes a popover without an event.
      if (!el.matches(":popover-open")) el.showPopover();
      x(e.clientX);
      y(e.clientY);
      const t = e.target as Element | null;
      if (!t || !(t instanceof Element)) return setMode("dot");
      if (t.closest(TEXT)) setMode("hidden");
      else if (t.closest(MACHINE)) setMode("claw");
      else if (t.closest(INTERACTIVE)) setMode("ring");
      else setMode("dot");
      el.dataset.on = "";
    };
    const onLeave = () => delete el.dataset.on;
    const onDown = () => (el.dataset.grab = "");
    const onUp = () => delete el.dataset.grab;
    // A modal <dialog> sits in the top layer, above any z-index. The cursor is a manual popover so it lives there too,
    // and it is shown again whenever a dialog opens, which puts it back on top.
    const raise = () => {
      if (el.matches(":popover-open")) el.hidePopover();
      el.showPopover();
    };
    raise();
    const dialogs = new MutationObserver((list) => {
      if (list.some((m) => m.target instanceof HTMLDialogElement && m.target.open)) raise();
    });
    dialogs.observe(document.body, { attributes: true, attributeFilter: ["open"], subtree: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    return () => {
      html.classList.remove("has-cursor");
      dialogs.disconnect();
      if (el.matches(":popover-open")) el.hidePopover();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return (
    <div ref={root} className="site-cursor" aria-hidden="true" data-mode="dot" popover="manual">
      <span className="site-cursor-dot" />
      <span className="site-cursor-ring" />
      <svg className="site-cursor-claw" viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`} width="30" height="30">
        <path d={MARK_BODY} fill={CREAM} />
        <g fill="none" stroke={CLAW} strokeWidth={PRONG_W} strokeLinejoin="miter">
          <path className="prong-l" d={LEFT} />
          <path d={MID} />
          <path className="prong-r" d={RIGHT} />
        </g>
      </svg>
    </div>
  );
}
