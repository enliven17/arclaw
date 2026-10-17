"use client";

/**
 * The site header: fixed, compact, quiet. Transparent over the hero; past it, ink at 85% with a backdrop blur and a
 * hairline. Scrolling down hides it, scrolling up brings it back. Phones get the logo and a menu button that opens a
 * full-screen menu (a native <dialog>: focus is trapped and Esc closes it). Sits above pinned sections.
 *
 * Reads the native scroll position, which Lenis drives, on a rAF-throttled listener; the motion is a CSS transform
 * transition, so nothing runs per frame while idle.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getLenis } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { Logo } from "./Logo";
import { SoundToggle } from "./SoundToggle";
import { play } from "@/lib/sfx";

const NAV = [
  { href: "/#machines", label: "Machines" },
  { href: "/#how", label: "How it works" },
  { href: "/#stocks", label: "Stocks" },
  { href: "/#gift", label: "Gift" },
  { href: "/#odds", label: "Odds" },
];

export function SiteHeader() {
  const [solid, setSolid] = useState(false);
  const [hidden, setHidden] = useState(false);
  const menu = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let last = window.scrollY;
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      const dy = y - last;
      last = y;
      setSolid(y > window.innerHeight * 0.85);
      if (y < 80) setHidden(false);
      else if (dy > 6) setHidden(true);
      else if (dy < -6) setHidden(false);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const open = () => {
    play("open");
    menu.current?.showModal();
    getLenis()?.stop();
  };
  const close = () => {
    play("close");
    menu.current?.close();
  };

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-[90] border-b transition-[transform,background-color,border-color] duration-300 ease-[var(--ease-out-quint)]",
          solid ? "border-line bg-ink/85 backdrop-blur-md" : "border-transparent bg-transparent",
          hidden ? "-translate-y-full" : "translate-y-0",
        )}
      >
        <div className="wrap flex h-14 items-center justify-between gap-6">
          <Link href="/" aria-label="arclaw home" className="rounded-[4px]">
            <Logo height={22} />
          </Link>
          <nav aria-label="Sections" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {NAV.map((n) => (
                <li key={n.href}>
                  <a href={n.href} className="rounded-[10px] px-3 py-2 text-[14px] text-muted transition-colors hover:text-cream">
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-2">
            <SoundToggle />
            <Link href="/app" className="btn-ghost !min-h-[36px] !px-3.5 !py-2 text-[14px]">
              Open app
            </Link>
            <button type="button" onClick={open} className="btn-ghost !min-h-[36px] !px-3 !py-2 text-[14px] md:hidden" aria-haspopup="dialog">
              Menu
            </button>
          </div>
        </div>
      </header>

      <dialog
        ref={menu}
        onClose={() => getLenis()?.start()}
        aria-label="Menu"
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-ink p-0 text-cream backdrop:bg-ink"
      >
        <div className="wrap flex h-14 items-center justify-between">
          <Logo height={22} />
          <button type="button" onClick={close} className="btn-ghost !min-h-[36px] !px-3 !py-2 text-[14px]" autoFocus>
            Close
          </button>
        </div>
        <nav aria-label="Sections" className="wrap mt-10">
          <ul className="grid gap-2">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} onClick={close} className="block py-2 text-[40px] leading-tight tracking-[-0.03em] text-cream">
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
          <Link href="/app" onClick={close} className="btn mt-10 w-full">
            Open app
          </Link>
        </nav>
      </dialog>
    </>
  );
}
