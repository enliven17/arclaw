"use client";

/**
 * Gift a box: a composer. Pick a machine and a count, send to an address or make a claim link, add a note, and
 * see the link preview your friend will get (the real /api/og/gift card). Sending needs a wallet, which the app
 * wires; the composer validates and previews today.
 */
/* eslint-disable @next/next/no-img-element -- the preview is our own generated PNG */
import { useEffect, useId, useState, type FormEvent } from "react";
import { isAddress } from "viem";
import { SplitHeading } from "@/components/motion/SmoothScroll";
import type { Machine } from "@/lib/machines";
import { usdc } from "@/lib/stocks";
import { cn } from "@/lib/cn";
import { MachineSwitch } from "./MachineSwitch";

type Mode = "link" | "address";
const MAX_BOXES = 10;
const MAX_NOTE = 80;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Gift({ machines }: { machines: Pick<Machine, "id" | "name" | "slug" | "priceUsdc">[] }) {
  const ids = useId();
  const [machineId, setMachineId] = useState(machines[0]!.id);
  const [count, setCount] = useState(1);
  const [mode, setMode] = useState<Mode>("link");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const machine = machines.find((m) => m.id === machineId) ?? machines[0]!;

  const addressOk = mode === "link" || isAddress(address.trim());
  const addressError = mode === "address" && address.trim().length > 0 && !isAddress(address.trim());
  const total = machine.priceUsdc * count;

  const preview = useDebounced(`/api/og/gift?machine=${machine.slug}&n=${count}${note.trim() ? `&note=${encodeURIComponent(note.trim())}` : ""}`, 350);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!addressOk) return;
    setStatus("Connect a wallet to send. Your gift is ready to go the moment you do.");
  };

  return (
    <section id="gift" aria-labelledby="gift-title" className="border-t border-line py-28 md:py-36">
      <div className="wrap">
        <div className="grid gap-8 md:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] md:items-end">
          <SplitHeading as="h2" id="gift-title" onScroll className="h-section" lines={["Send a box.", "They open it."]} />
          <p className="lede max-w-[26em] md:justify-self-end" data-reveal>
            Buy boxes for someone else. They stay sealed until your friend opens them, and the stocks land in their wallet.
          </p>
        </div>

        <div className="mt-16 grid gap-4 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]" data-reveal>
          <form onSubmit={onSubmit} className="flex flex-col gap-7 rounded-[18px] border border-line bg-panel p-6 md:p-8" noValidate>
            <fieldset>
              <legend className="text-[15px] text-cream">Machine</legend>
              <MachineSwitch machines={machines} value={machineId} onChange={setMachineId} label="Machine" className="mt-3" />
            </fieldset>

            <div>
              <label htmlFor={`${ids}-count`} className="text-[15px] text-cream">
                Boxes
              </label>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex items-center rounded-[10px] border border-line-strong bg-panel-2">
                  <button type="button" aria-label="One box fewer" onClick={() => setCount((c) => Math.max(1, c - 1))} className="size-12 rounded-l-[10px] text-[20px] text-cream hover:bg-panel disabled:opacity-40" disabled={count <= 1}>
                    -
                  </button>
                  <input
                    id={`${ids}-count`}
                    inputMode="numeric"
                    value={count}
                    onChange={(e) => {
                      const n = Number(e.target.value.replace(/\D/g, ""));
                      setCount(Math.min(MAX_BOXES, Math.max(1, n || 1)));
                    }}
                    className="money h-12 w-14 bg-transparent text-center text-[18px] text-cream outline-none"
                    aria-describedby={`${ids}-total`}
                  />
                  <button type="button" aria-label="One box more" onClick={() => setCount((c) => Math.min(MAX_BOXES, c + 1))} className="size-12 rounded-r-[10px] text-[20px] text-cream hover:bg-panel disabled:opacity-40" disabled={count >= MAX_BOXES}>
                    +
                  </button>
                </div>
                <p id={`${ids}-total`} className="text-[15px] text-muted">
                  <span className="money text-cream">{usdc(total)} USDC</span> for {count} {machine.name} {count === 1 ? "box" : "boxes"}
                </p>
              </div>
            </div>

            <fieldset>
              <legend className="text-[15px] text-cream">Send as</legend>
              <div role="radiogroup" aria-label="Send as" className="mt-3 grid grid-cols-2 gap-1 rounded-[14px] border border-line bg-panel p-1">
                {(
                  [
                    ["link", "Claim link"],
                    ["address", "To an address"],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setMode(m)}
                    className={cn("min-h-[48px] rounded-[10px] text-[15px] transition-colors", mode === m ? "bg-cream text-ink" : "text-muted hover:bg-panel-2 hover:text-cream")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {mode === "address" ? (
                <div className="mt-4">
                  <label htmlFor={`${ids}-addr`} className="sr-only">
                    Recipient address
                  </label>
                  <input
                    id={`${ids}-addr`}
                    className={cn("input money", addressError && "!border-cream")}
                    placeholder="0x recipient on Arc"
                    spellCheck={false}
                    autoComplete="off"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    aria-invalid={addressError || undefined}
                    aria-describedby={`${ids}-addr-help`}
                  />
                  <p id={`${ids}-addr-help`} className="mt-2 text-[14px] text-muted">
                    {addressError ? "That is not an Arc address. It should be 0x and 40 hex characters." : "The boxes are theirs the moment the play settles."}
                  </p>
                </div>
              ) : (
                <p className="mt-4 text-[14px] leading-relaxed text-muted">
                  The link carries a one-time key: claiming signs your friend&apos;s own address with it, so nobody who sees
                  the link first can take the box.
                </p>
              )}
            </fieldset>

            <div>
              <label htmlFor={`${ids}-note`} className="flex justify-between text-[15px] text-cream">
                <span>Note</span>
                <span className="money text-[13px] text-muted">
                  {note.length}/{MAX_NOTE}
                </span>
              </label>
              <textarea
                id={`${ids}-note`}
                className="input mt-3 min-h-[88px] resize-none"
                maxLength={MAX_NOTE}
                placeholder="Happy birthday. Open it on stream."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
              <button type="submit" className="btn" disabled={!addressOk || (mode === "address" && !address.trim())}>
                {mode === "link" ? "Create claim link" : "Send gift"} <span className="money">{usdc(total)} USDC</span>
              </button>
              <p role="status" className="text-[14px] text-muted">
                {status}
              </p>
            </div>
          </form>

          <div className="flex flex-col rounded-[18px] border border-line bg-panel p-6 md:p-8">
            <p className="text-[15px] text-cream">What they see</p>
            <div className="mt-4 overflow-hidden rounded-[14px] border border-line-strong bg-panel-2">
              <img
                src={preview}
                alt={`Link preview: ${count} sealed ${machine.name} ${count === 1 ? "box" : "boxes"}${note.trim() ? `, with the note ${note.trim()}` : ""}.`}
                width={1200}
                height={630}
                className="block aspect-[1200/630] w-full bg-ink"
              />
              <div className="border-t border-line px-4 py-3">
                <p className="text-[15px] text-cream">
                  {count === 1 ? "You got a sealed box" : `You got ${count} sealed boxes`}
                </p>
                <p className="money mt-1 truncate text-[13px] text-muted">{mode === "link" ? "arclaw.app/claim/7Hq2xV9c" : "Delivered to your wallet on Arc"}</p>
              </div>
            </div>
            <p className="mt-auto pt-6 text-[14px] leading-relaxed text-muted">
              A gifted box has the same odds as one you play yourself, and it stays sealed until your friend opens it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
