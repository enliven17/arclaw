"use client";

/**
 * Send a box, from the side that receives it: a gift box arrives, three packs drop into it, the lid closes, a
 * ribbon ties itself around it (the section's one accent) and a note card swings on. Sending happens in the app
 * (/app/gifts); this only shows what your friend gets.
 *
 * Wide screens with a fine pointer pin and scrub; everything else plays once in view. Without JS or with reduced
 * motion the wrapped gift shows as it ends.
 */
import Link from "next/link";
import { useRef } from "react";
import { PINNED, REDUCED, ScrollTrigger, gsap, pinType, useGSAP } from "@/lib/motion";
import { whenSplashDone } from "@/lib/splash";
import { SplitHeading } from "@/components/motion/SmoothScroll";
import { BoosterPack } from "@/components/pack/BoosterPack";
import { Logo } from "@/components/Logo";

const PACKS = ["Single", "Stack", "Vault"];

export function GiftShowcase() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      let live = true;
      void whenSplashDone().then(() => {
        if (!live) return;
        mm.add({ pinned: PINNED, reduced: REDUCED, any: "all" }, (ctx) => {
          const { pinned, reduced } = ctx.conditions as { pinned: boolean; reduced: boolean };
          if (reduced) return;
          const q = gsap.utils.selector(el);
          const box = q("[data-gbox]");
          const packs = q("[data-gpack]");
          const lid = q("[data-glid]");
          const ribbonV = q("[data-rib-v]");
          const ribbonH = q("[data-rib-h]");
          const bow = q("[data-bow]");
          const note = q("[data-note]");

          gsap.set(box, { yPercent: 60, opacity: 0 });
          gsap.set(packs, { yPercent: -420, opacity: 0, rotate: (i: number) => [-8, 4, 10][i] });
          gsap.set(lid, { yPercent: -500, opacity: 0, rotate: -4 });
          gsap.set(ribbonV, { scaleY: 0 });
          gsap.set(ribbonH, { scaleX: 0 });
          gsap.set(bow, { scale: 0, rotate: -30 });
          gsap.set(note, { yPercent: -160, rotate: -24, opacity: 0 });

          const tl = gsap.timeline({ defaults: { ease: "power3.out" }, paused: !pinned });
          tl.to(box, { yPercent: 0, opacity: 1, duration: 0.8, ease: "back.out(1.2)" })
            .to(packs, { yPercent: 0, opacity: 1, rotate: (i: number) => [-6, 2, 7][i], duration: 0.7, stagger: 0.22, ease: "power2.in" }, "+=0.1")
            .to(packs, { yPercent: 12, duration: 0.18, stagger: 0.22, ease: "power1.out" }, "<0.7")
            // Settle into the box, below the rim, before the lid goes on.
            .to(packs, { yPercent: 95, duration: 0.45, stagger: 0.06, ease: "power2.in" }, "+=0.15")
            .to(lid, { yPercent: 0, opacity: 1, rotate: 0, duration: 0.7, ease: "back.out(1.4)" }, "+=0.15")
            .to(ribbonV, { scaleY: 1, duration: 0.6, ease: "power2.inOut" })
            .to(ribbonH, { scaleX: 1, duration: 0.6, ease: "power2.inOut" }, "<0.25")
            .to(bow, { scale: 1, rotate: 0, duration: 0.6, ease: "back.out(2)" })
            .to(note, { yPercent: 0, opacity: 1, rotate: 7, duration: 0.7, ease: "back.out(1.3)" }, "+=0.1")
            .to(note, { rotate: 4, duration: 0.5, ease: "sine.inOut" })
            .to({}, { duration: 0.4 });

          if (pinned) {
            ScrollTrigger.create({ trigger: el, start: "top top", end: "+=1800", pin: true, pinType: pinType(), scrub: 0.8, animation: tl, anticipatePin: 1 });
          } else {
            tl.timeScale(1.15);
            ScrollTrigger.create({ trigger: q("[data-gift-stage]")[0], start: "top 75%", once: true, onEnter: () => tl.play() });
          }
        });
        ScrollTrigger.refresh();
      });
      return () => {
        live = false;
        mm.revert();
      };
    },
    { scope: root },
  );

  return (
    <section ref={root} id="gift" aria-labelledby="gift-title" className="border-t border-line">
      <div className="wrap grid min-h-dvh items-center gap-10 py-20 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12 md:py-10">
        <div>
          <SplitHeading as="h2" id="gift-title" onScroll className="h-section !text-[clamp(44px,5vw,88px)]" lines={["Send a box.", "They open it."]} />
          <p className="lede mt-6 max-w-[26em]" data-reveal>
            Wrap a box or ten for a friend. It stays sealed until they open it, and the stocks land in their wallet.
          </p>
          <p className="mt-4 max-w-[30em] text-[15px] leading-relaxed text-muted" data-reveal>
            Send it to their address, or as a claim link. The link carries a one-time key, so whoever opens it first claims
            the box for their own wallet, and nobody can take it on the way.
          </p>
          <div className="mt-8" data-reveal>
            <Link href="/app/gifts" className="btn-cream">
              Send a gift
            </Link>
          </div>
        </div>

        <div data-gift-stage="" className="relative mx-auto aspect-[6/5] w-full max-w-[720px] overflow-hidden rounded-[18px] border border-line bg-panel" aria-hidden="true">
          <div className="absolute inset-x-0 bottom-[12%] mx-auto w-[56%]">
            {/* The box: back wall (inside), the packs in it, the front, the lid, the ribbon, the bow, the note. */}
            <div data-gbox="" className="relative aspect-[10/6]">
              <div className="absolute inset-x-[3%] top-[14%] h-[30%] rounded-t-[6px] bg-[#141418]" />
              <div className="absolute inset-x-0 top-[-16%] flex justify-center gap-[3%] px-[12%]">
                {PACKS.map((name, i) => (
                  <div key={name} data-gpack="" className="relative w-[24%]" style={{ zIndex: 1 }}>
                    <BoosterPack machine={name} uid={`gift-pack-${i}`} />
                  </div>
                ))}
              </div>
              <div className="absolute inset-x-0 bottom-0 top-[40%] z-10 rounded-b-[10px] border border-line-strong bg-panel-2">
                <div data-rib-h="" className="absolute inset-x-0 top-[38%] h-[16%] origin-left bg-claw" />
                <div className="absolute bottom-[10%] left-[6%]">
                  <Logo variant="wordmark" height={14} />
                </div>
              </div>
              <div data-rib-v="" className="absolute bottom-0 left-1/2 top-[28%] z-20 w-[9%] -translate-x-1/2 origin-top bg-claw" />
              <div data-glid="" className="absolute inset-x-[-4%] top-[24%] z-20 h-[18%] rounded-[8px] border border-line-strong bg-[#24242b]">
                <div className="absolute inset-y-0 left-1/2 w-[9%] -translate-x-1/2 bg-claw" />
              </div>
              <svg data-bow="" viewBox="0 0 120 60" className="absolute left-1/2 top-[8%] z-30 w-[34%] -translate-x-1/2">
                <path d="M60 34C44 6 12 4 10 22C8 40 40 44 60 34Z" fill="var(--color-claw)" />
                <path d="M60 34C76 6 108 4 110 22C112 40 80 44 60 34Z" fill="var(--color-claw)" />
                <path d="M60 34C50 22 34 18 26 24M60 34C70 22 86 18 94 24" stroke="#0c0c0e" strokeOpacity="0.35" strokeWidth="2" fill="none" />
                <rect x="52" y="26" width="16" height="16" rx="4" fill="#d94a16" />
              </svg>
              <div data-note="" className="absolute right-[-4%] top-[-24%] z-40 w-[36%] sm:right-[-14%] sm:w-[40%] origin-top-left rounded-[10px] border border-line-strong bg-cream p-[4%] text-ink" style={{ rotate: "4deg" }}>
                <p className="text-[clamp(11px,1.1vw,15px)] leading-snug">Happy birthday, Ada. Pull something good.</p>
                <p className="money mt-2 text-[clamp(10px,0.9vw,12px)] text-ink/60">from Kaan</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
