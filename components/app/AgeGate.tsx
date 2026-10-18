"use client";

/**
 * Asked once per browser, before the app: you are 18 or older, you are allowed to play where you live, and prizes are
 * tokenized stocks that can lose value. A native modal <dialog> with no Esc and no backdrop close; the answer is kept in
 * localStorage. It is a speed bump and a record of consent, not identity verification.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getLenis } from "@/lib/motion";

const KEY = "arclaw:age-ok";

export function AgeGate() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let ok = false;
    try {
      ok = window.localStorage.getItem(KEY) === "1";
    } catch {
      // Private mode: ask on every visit.
    }
    if (ok) return;
    const d = dialog.current;
    if (!d || d.open) return;
    d.showModal();
    getLenis()?.stop();
  }, []);

  const enter = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      // The answer lasts for this page only.
    }
    dialog.current?.close();
    getLenis()?.start();
  };

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => e.preventDefault()}
      aria-labelledby="age-title"
      className="m-auto w-[min(480px,calc(100vw-32px))] rounded-[18px] border border-line bg-panel p-0 text-cream backdrop:bg-ink/90 backdrop:backdrop-blur-sm"
    >
      <div className="p-6 md:p-8">
        <h2 id="age-title" className="text-[28px] leading-tight tracking-[-0.02em]">
          Before you play.
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          arclaw is a game of chance. Most boxes are worth less than their price, the stocks in a box can lose value, and you can
          lose what you pay. Only play with money you can afford to lose.
        </p>
        <label className="mt-6 flex cursor-pointer items-start gap-3 text-[15px] leading-relaxed">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-1 size-4 accent-[var(--color-cream)]" />
          <span>I am 18 or older, and I am allowed to play games of chance with prizes where I live.</span>
        </label>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" className="btn-cream" disabled={!checked} onClick={enter}>
            Enter
          </button>
          <Link href="/" className="btn-ghost">
            Leave
          </Link>
        </div>
        <p className="mt-5 text-[13px] text-muted">
          Read the <Link href="/disclaimer" className="underline underline-offset-4">risk disclaimer</Link>.
        </p>
      </div>
    </dialog>
  );
}
