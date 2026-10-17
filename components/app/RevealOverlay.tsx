"use client";

/**
 * The reveal, full screen. One box at a time from a queue:
 *
 *   sealed  the box from its machine; it waits while the draw comes in, then a tap opens it
 *   pack    the lid lifts and a booster pack rises out; tap (or drag across its top) to tear it
 *   deal    each tap deals one face-down card into its place, three in all, then the wrapper drops away
 *   flip    tap any card to turn it; Legendary and Jackpot get a bigger moment (a lift and a sting, no glow)
 *   done    the pack's total, share, the next box or the summary
 *
 * A native <dialog>: focus is trapped and Esc closes it. The stage is one button whose label says what the next tap
 * does, so the whole sequence works from the keyboard. Reduced motion: every step happens without travel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { BoosterPack } from "@/components/pack/BoosterPack";
import { SealedBox } from "@/components/pack/SealedBox";
import { StockCard } from "@/components/landing/StockCard";
import { variantOf } from "@/components/claw/view";
import { toUsdc, type DrawnBox } from "@/lib/arclaw/contract";
import { usdc } from "@/lib/stocks";
import { cn } from "@/lib/cn";

type Stage = "sealed" | "pack" | "deal" | "flip" | "done";

export type RevealWaiting = { label: string; action?: { label: string; onClick: () => void } } | null;

const BIG = new Set(["Legendary", "Jackpot"]);
const RARE = new Set(["Rare", "Epic"]);

export function pullUrl(box: DrawnBox): string {
  const p = new URLSearchParams({
    tickers: box.cards.map((c) => c.ticker).join(","),
    amounts: box.cards.map((c) => toUsdc(c.valueWei).toFixed(2)).join(","),
    tier: box.tierName,
  });
  return `/pull?${p.toString()}`;
}

export function RevealOverlay({
  open,
  machine,
  boxes,
  waiting,
  explorerUrl,
  onClose,
  onAnother,
}: {
  open: boolean;
  machine: { name: string; slug: string };
  /** The drawn boxes, or null while the draw is still coming in. */
  boxes: DrawnBox[] | null;
  waiting: RevealWaiting;
  explorerUrl?: string;
  onClose: () => void;
  onAnother?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<Stage>("sealed");
  const [dealt, setDealt] = useState(0);
  const [flipped, setFlipped] = useState<boolean[]>([false, false, false]);
  const [summary, setSummary] = useState(false);
  const busy = useRef(false);
  const still = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const box = boxes?.[index] ?? null;
  const ready = Boolean(box);
  const total = useMemo(() => (boxes ?? []).reduce((s, b) => s + b.cards.reduce((t, c) => t + toUsdc(c.valueWei), 0), 0), [boxes]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      play("open");
    } else if (!open && d.open) d.close();
  }, [open]);

  // A new box: back to sealed.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the sequence when the queue moves on
    setStep("sealed");
    setDealt(0);
    setFlipped([false, false, false]);
  }, [index, boxes]);

  const q = (sel: string) => stage.current?.querySelectorAll<HTMLElement>(sel) ?? [];

  // Cards start face down and stacked in the pack.
  useEffect(() => {
    gsap.set(q("[data-card-inner]"), { rotateY: 0 });
    gsap.set(q("[data-rv-card]"), { opacity: 0, yPercent: 30, xPercent: 0, rotate: 0, zIndex: 10 });
    gsap.set(q("[data-rv-pack]"), { opacity: 0, yPercent: 40, scale: 0.85 });
    gsap.set(q("[data-rv-box]"), { opacity: 1, yPercent: 0, scale: 1 });
    gsap.set(q("[data-lid]"), { yPercent: 0, rotate: 0, opacity: 1 });
    gsap.set(q("[data-pack-strip]"), { x: 0, y: 0, rotate: 0, skewX: 0, scaleY: 1, opacity: 1 });
  }, [index, boxes]);  

  const d = still ? 0.01 : 1;

  const openBox = useCallback(() => {
    busy.current = true;
    play("box");
    gsap
      .timeline({ onComplete: () => ((busy.current = false), setStep("pack")) })
      .to(q("[data-lid]"), { yPercent: -140, rotate: -10, opacity: 0, duration: 0.6 * d, ease: "power2.inOut" })
      .to(q("[data-rv-pack]"), { opacity: 1, yPercent: 0, scale: 1, duration: 0.7 * d, ease: "back.out(1.3)" }, 0.2 * d)
      .to(q("[data-rv-box]"), { yPercent: 40, opacity: 0, duration: 0.5 * d, ease: "power2.in" }, 0.35 * d);
  }, [d]);  

  const tear = useCallback(() => {
    busy.current = true;
    play("tear");
    gsap
      .timeline({ onComplete: () => ((busy.current = false), setStep("deal")) })
      .to(q("[data-rv-pack]"), { rotate: -2, duration: 0.06 * d, yoyo: true, repeat: 3, ease: "sine.inOut" })
      .to(q("[data-pack-strip]"), { rotate: -14, skewX: -8, x: 6, y: -6, duration: 0.25 * d, ease: "power2.in" })
      .to(q("[data-pack-strip]"), { rotate: -40, skewX: -18, scaleY: 0.7, x: 90, y: -120, opacity: 0, duration: 0.5 * d, ease: "power2.in" });
  }, [d]);  

  const deal = useCallback(() => {
    const i = dealt;
    const cards = q("[data-rv-card]");
    const card = cards[i];
    if (!card) return;
    busy.current = true;
    play("deal");
    const tl = gsap.timeline({
      onComplete: () => {
        busy.current = false;
        setDealt(i + 1);
        if (i === 2) setStep("flip");
      },
    });
    tl.fromTo(card, { opacity: 1, yPercent: -10, xPercent: 0, scale: 0.85 }, { yPercent: -70, duration: 0.25 * d, ease: "power2.out" })
      .set(card, { zIndex: 30 })
      .to(card, {
      xPercent: (i - 1) * 108,
      yPercent: 0,
      scale: 1,
      rotate: (i - 1) * 3,
      duration: 0.45 * d,
      ease: "power3.out",
    });
    if (i === 2) tl.to(q("[data-rv-pack]"), { yPercent: 80, opacity: 0, duration: 0.5 * d, ease: "power2.in" }, "<");
  }, [dealt, d]);  

  const flip = useCallback(
    (i: number) => {
      if (!box || flipped[i]) return;
      const inner = q("[data-card-inner]")[i];
      const card = q("[data-rv-card]")[i];
      if (!inner || !card) return;
      const big = BIG.has(box.tierName);
      play(big ? "jackpot" : RARE.has(box.tierName) ? "rare" : "flip");
      const next = flipped.map((f, k) => f || k === i);
      const tl = gsap.timeline({ onComplete: () => next.every(Boolean) && setTimeout(() => setStep("done"), still ? 0 : 450) });
      if (big && !still) tl.to(card, { scale: 1.12, yPercent: -6, duration: 0.25, ease: "power2.out" });
      tl.to(inner, { rotateY: 180, duration: 0.7 * d, ease: "back.out(1.2)" }, big ? "-=0.05" : 0);
      if (big && !still) tl.to(card, { scale: 1, yPercent: 0, duration: 0.5, ease: "power3.out" }, "+=0.15");
      setFlipped(next);
    },
    [box, flipped, d, still],  
  );

  const advance = () => {
    if (busy.current || !ready) return;
    if (step === "sealed") openBox();
    else if (step === "pack") tear();
    else if (step === "deal") deal();
    else if (step === "flip") flip(flipped.findIndex((f) => !f));
  };

  // Drag across the pack's top to tear it (tap still works).
  const dragFrom = useRef<number | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (step === "pack") dragFrom.current = e.clientX;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (step === "pack" && dragFrom.current !== null && Math.abs(e.clientX - dragFrom.current) > 40 && !busy.current) {
      dragFrom.current = null;
      tear();
      return;
    }
    dragFrom.current = null;
  };

  const nextLabel = !ready
    ? (waiting?.label ?? "Drawing your cards")
    : step === "sealed"
      ? "Tap the box to open it"
      : step === "pack"
        ? "Tap the pack, or drag across its top, to tear it"
        : step === "deal"
          ? `Tap to deal card ${dealt + 1} of 3`
          : step === "flip"
            ? "Tap a card to turn it over"
            : `${box?.tierName} pack`;

  const count = boxes?.length ?? 0;
  const close = () => {
    play("close");
    onClose();
  };

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label={`Opening a ${machine.name} box`}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-ink p-0 text-cream backdrop:bg-ink"
    >
      <div className="flex h-full flex-col">
        <div className="wrap flex h-14 shrink-0 items-center justify-between gap-4">
          <p className="text-[15px] text-muted">
            {machine.name}
            {count > 1 && !summary ? <span className="money ml-3 text-cream">{`${index + 1} of ${count}`}</span> : null}
          </p>
          <div className="flex items-center gap-2">
            {count > 1 && !summary && ready ? (
              <button type="button" className="btn-ghost !min-h-[36px] !px-3 !py-2 text-[14px]" onClick={() => setSummary(true)}>
                Skip to summary
              </button>
            ) : null}
            <button type="button" className="btn-ghost !min-h-[36px] !px-3 !py-2 text-[14px]" onClick={close}>
              Close
            </button>
          </div>
        </div>

        {summary ? (
          <Summary boxes={boxes ?? []} total={total} explorerUrl={explorerUrl} onAnother={onAnother} onClose={close} />
        ) : (
          <>
            <div
              ref={stage}
              role="button"
              tabIndex={0}
              aria-label={nextLabel}
              aria-disabled={!ready || step === "done"}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("[data-rv-card]") && step === "flip") return;
                advance();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  advance();
                }
              }}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              className={cn("relative mx-auto grid w-full max-w-[880px] flex-1 select-none place-items-center outline-none", ready && step !== "done" ? "cursor-pointer" : "")}
              data-cursor="ring"
            >
              <div className="relative grid aspect-square w-[min(84vw,64vh)] place-items-center">
                <div data-rv-box="" className="absolute w-[62%]">
                  <SealedBox variant={variantOf(machine.slug)} />
                </div>
                <div data-rv-pack="" className="pointer-events-none absolute z-20 w-[40%]">
                  <BoosterPack machine={machine.name} tier={box && step !== "sealed" && step !== "pack" ? box.tier : undefined} uid="reveal-pack" />
                </div>
                {/* No z-index here: each card stacks on its own, under the pack until it is dealt, above it after. */}
                <div className="absolute inset-0 grid place-items-center">
                  {(box?.cards ?? []).map((c, i) => (
                    <button
                      key={`${index}-${i}`}
                      type="button"
                      data-rv-card=""
                      className="relative z-10 col-start-1 row-start-1 w-[30%]"
                      tabIndex={step === "flip" && !flipped[i] ? 0 : -1}
                      aria-label={flipped[i] ? `${c.ticker}, ${usdc(toUsdc(c.valueWei))} USDC` : `Turn card ${i + 1}`}
                      onClick={() => step === "flip" && flip(i)}
                    >
                      <StockCard card={{ ticker: c.ticker, name: c.name, amount: toUsdc(c.valueWei) }} tier={box!.tierName} index={i} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="wrap flex min-h-[132px] shrink-0 flex-col items-center justify-start gap-3 pb-8 text-center">
              {step === "done" && box ? (
                <>
                  <p className={cn("text-[clamp(28px,3.4vw,44px)] leading-none tracking-[-0.03em]", BIG.has(box.tierName) && "text-prize")}>
                    {box.tierName} <span className="money text-cream">{usdc(box.cards.reduce((t, c) => t + toUsdc(c.valueWei), 0))} USDC</span>
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <ShareButton url={pullUrl(box)} />
                    {index + 1 < count ? (
                      <button type="button" className="btn-cream" onClick={() => setIndex(index + 1)}>
                        Next box
                      </button>
                    ) : count > 1 ? (
                      <button type="button" className="btn-cream" onClick={() => setSummary(true)}>
                        See all
                      </button>
                    ) : onAnother ? (
                      <button type="button" className="btn-cream" onClick={onAnother}>
                        Open another
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[16px] text-muted" aria-live="polite">
                    {nextLabel}
                  </p>
                  {!ready && waiting?.action ? (
                    <button type="button" className="btn" onClick={waiting.action.onClick}>
                      {waiting.action.label}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}

function ShareButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const full = `${window.location.origin}${url}`;
    try {
      if (navigator.share) await navigator.share({ url: full, title: "My arclaw pull" });
      else {
        await navigator.clipboard.writeText(full);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }
    } catch {
      // Share sheet dismissed.
    }
  };
  return (
    <button type="button" className="btn-ghost" onClick={() => void share()}>
      {copied ? "Link copied" : "Share"}
    </button>
  );
}

function Summary({ boxes, total, explorerUrl, onAnother, onClose }: { boxes: DrawnBox[]; total: number; explorerUrl?: string; onAnother?: () => void; onClose: () => void }) {
  return (
    <div className="wrap flex-1 overflow-y-auto py-6">
      <h2 className="text-[clamp(32px,4vw,56px)] leading-none tracking-[-0.03em]">
        {boxes.length} {boxes.length === 1 ? "pack" : "packs"} <span className="money">{usdc(total)} USDC</span>
      </h2>
      <ul className="mt-8 grid gap-3">
        {boxes.map((b) => (
          <li key={b.boxIndex} className="flex flex-col gap-3 rounded-[14px] border border-line bg-panel p-4 md:flex-row md:items-center md:justify-between">
            <p className={cn("text-[18px]", BIG.has(b.tierName) ? "text-prize" : "text-cream")}>{b.tierName}</p>
            <p className="money text-[15px] text-muted">{b.cards.map((c) => `${c.ticker} ${usdc(toUsdc(c.valueWei))}`).join("   ")}</p>
            <p className="money text-[16px]">{usdc(b.cards.reduce((t, c) => t + toUsdc(c.valueWei), 0))} USDC</p>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex flex-wrap gap-2">
        {onAnother ? (
          <button type="button" className="btn-cream" onClick={onAnother}>
            Open another
          </button>
        ) : null}
        <a className="btn-ghost" href="/app/collection">
          Collection
        </a>
        {explorerUrl ? (
          <a className="btn-ghost" href={explorerUrl} target="_blank" rel="noopener noreferrer">
            View on explorer
          </a>
        ) : null}
        <button type="button" className="btn-ghost" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
