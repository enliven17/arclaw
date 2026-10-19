"use client";

/**
 * Gifts: send sealed boxes you hold, to an address or as a claim link, with a preview of what your friend sees.
 *
 *   address  one ERC-1155 transfer of n boxes (safeTransferFrom)
 *   link     a fresh key is made in this browser; n boxes move into ArclawLinks with (linkKey, expiresAt) as data.
 *            Once that is confirmed the link is shown: /claim?m=<machine>&n=<boxes>&note=<note>#<key>&<linkId>.
 *            The key sits after the #, so it never reaches a server; the query only drives the preview card.
 *   My gifts links you made from this browser (kept locally), with their state and a reclaim after expiry.
 */
/* eslint-disable @next/next/no-img-element -- the preview is our own generated PNG */
import { useCallback, useEffect, useId, useState } from "react";
import { isAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { useWallet } from "@/components/wallet/WalletProvider";
import { MachineSwitch } from "@/components/landing/MachineSwitch";
import { arcClient } from "@/lib/arc/chain";
import { LINKS, createLinkCall, giftCall, linkFromLogs, readBoxes, readLink, reclaimLinkCall, revertText } from "@/lib/arclaw/contract";
import type { Machine } from "@/lib/machines";
import { usdc } from "@/lib/stocks";
import { cn } from "@/lib/cn";

type Mode = "link" | "address";
type Lite = Pick<Machine, "id" | "name" | "slug" | "priceUsdc">;
type SavedLink = { linkId: string; url: string; machineId: number; boxes: number; expiresAt: number };

const MAX_NOTE = 80;
const DAYS = 7;
const SAVED = "arclaw:links";

const loadSaved = (): SavedLink[] => {
  try {
    return JSON.parse(localStorage.getItem(SAVED) ?? "[]") as SavedLink[];
  } catch {
    return [];
  }
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function GiftComposer({ machines, initial }: { machines: Lite[]; initial?: string }) {
  const ids = useId();
  const w = useWallet();
  const [machineId, setMachineId] = useState(machines.find((m) => m.slug === initial)?.id ?? machines[0]!.id);
  const [count, setCount] = useState(1);
  const [mode, setMode] = useState<Mode>(LINKS ? "link" : "address");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [held, setHeld] = useState<Record<number, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const machine = machines.find((m) => m.id === machineId) ?? machines[0]!;

  const refresh = useCallback(async () => {
    if (!w.address) return setHeld(null);
    setHeld(await readBoxes(arcClient(), w.address).catch(() => null));
  }, [w.address]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the chain for the connected wallet
    void refresh();
  }, [refresh]);

  const have = held?.[machine.id] ?? 0;
  const addressOk = mode === "link" || isAddress(address.trim());
  const addressError = mode === "address" && address.trim().length > 0 && !isAddress(address.trim());
  const preview = useDebounced(`/api/og/gift?machine=${machine.slug}&n=${count}${note.trim() ? `&note=${encodeURIComponent(note.trim())}` : ""}`, 350);
  const linksOff = mode === "link" && !LINKS;

  const send = async () => {
    if (!w.address) return w.openConnect();
    if (!addressOk || count > have || linksOff) return;
    setBusy(true);
    setStatus(null);
    setMade(null);
    try {
      if (mode === "address") {
        await w.send([giftCall(w.address, address.trim() as Address, machine.id, count)]);
        setStatus(`${count === 1 ? "The box is" : `${count} boxes are`} on the way to ${address.trim().slice(0, 6)}...${address.trim().slice(-4)}.`);
      } else {
        const key = generatePrivateKey();
        const linkKey = privateKeyToAccount(key).address;
        const expiresAt = Math.floor(Date.now() / 1000) + DAYS * 86_400;
        const hash: Hex = await w.send([createLinkCall(w.address, linkKey, machine.id, count, expiresAt)]);
        const receipt = await arcClient().getTransactionReceipt({ hash });
        const link = linkFromLogs(receipt.logs);
        if (!link) throw new Error("The boxes moved but the link was not found. Check My gifts.");
        // Only now, with the escrow confirmed, is the link safe to share.
        const q = new URLSearchParams({ m: machine.slug, n: String(count), ...(note.trim() ? { note: note.trim() } : {}) });
        const url = `${window.location.origin}/claim?${q.toString()}#${key}&${link.linkId}`;
        const saved = [{ linkId: String(link.linkId), url, machineId: machine.id, boxes: count, expiresAt }, ...loadSaved()].slice(0, 50);
        localStorage.setItem(SAVED, JSON.stringify(saved));
        setMade(url);
        setStatus("Your link is ready. Anyone with it can claim the boxes, so send it only to your friend.");
      }
      await refresh();
    } catch (e) {
      setStatus(revertText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap py-10 md:py-14">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <h1 className="h-section !text-[clamp(40px,5vw,80px)]">Send a box.</h1>
        <p className="lede max-w-[26em]">Boxes stay sealed until your friend opens them, and the stocks land in their wallet.</p>
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex flex-col gap-7 rounded-[18px] border border-line bg-panel p-6 md:p-8"
          noValidate
        >
          <fieldset>
            <legend className="text-[15px] text-cream">Machine</legend>
            <MachineSwitch machines={machines} value={machineId} onChange={setMachineId} label="Machine" className="mt-3" />
            <p className="mt-2 text-[14px] text-muted">
              {w.address ? (
                <>
                  You hold <span className="money text-cream">{have}</span> sealed {machine.name} {have === 1 ? "box" : "boxes"}.{" "}
                  {have === 0 ? (
                    <a className="text-cream underline underline-offset-4" href={`/app/play/${machine.slug}`}>
                      Play to get one
                    </a>
                  ) : null}
                </>
              ) : (
                "Connect to see the boxes you can send."
              )}
            </p>
          </fieldset>

          <div>
            <label htmlFor={`${ids}-count`} className="text-[15px] text-cream">
              Boxes
            </label>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex items-center rounded-[10px] border border-line-strong bg-panel-2">
                <button type="button" aria-label="One box fewer" onClick={() => setCount((c) => Math.max(1, c - 1))} className="size-12 rounded-l-[10px] text-[20px] hover:bg-panel disabled:opacity-40" disabled={count <= 1}>
                  -
                </button>
                <input id={`${ids}-count`} inputMode="numeric" value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))} className="money h-12 w-14 bg-transparent text-center text-[18px] outline-none" />
                <button type="button" aria-label="One box more" onClick={() => setCount((c) => c + 1)} className="size-12 rounded-r-[10px] text-[20px] hover:bg-panel disabled:opacity-40" disabled={!!held && count >= have}>
                  +
                </button>
              </div>
              <p className="text-[15px] text-muted">
                worth <span className="money text-cream">{usdc(machine.priceUsdc * count)} USDC</span> at play price
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
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn("min-h-[48px] rounded-[10px] text-[15px] transition-colors", mode === m ? "bg-cream text-ink" : "text-muted hover:bg-panel-2 hover:text-cream")}>
                  {label}
                </button>
              ))}
            </div>
            {mode === "address" ? (
              <div className="mt-4">
                <label htmlFor={`${ids}-addr`} className="sr-only">
                  Recipient address
                </label>
                <input id={`${ids}-addr`} className={cn("input money", addressError && "!border-cream")} placeholder="0x recipient on Arc" spellCheck={false} autoComplete="off" value={address} onChange={(e) => setAddress(e.target.value)} aria-invalid={addressError || undefined} aria-describedby={`${ids}-addr-help`} />
                <p id={`${ids}-addr-help`} className="mt-2 text-[14px] text-muted">
                  {addressError ? "That is not an Arc address. It should be 0x and 40 hex characters." : "The boxes are theirs as soon as the transfer settles."}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-[14px] leading-relaxed text-muted">
                {LINKS
                  ? "The link carries a one-time key: claiming signs your friend's own address with it, so nobody who sees the link first can take the box. Unclaimed after 7 days, you can take the boxes back."
                  : "Claim links open after the next contract update. Send to an address for now."}
              </p>
            )}
          </fieldset>

          {mode === "link" ? (
            <div>
              <label htmlFor={`${ids}-note`} className="flex justify-between text-[15px] text-cream">
                <span>Note</span>
                <span className="money text-[13px] text-muted">
                  {note.length}/{MAX_NOTE}
                </span>
              </label>
              <textarea id={`${ids}-note`} className="input mt-3 min-h-[88px] resize-none" maxLength={MAX_NOTE} placeholder="Happy birthday. Pull something good." value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-line pt-6">
            <button type="submit" className="btn self-start" disabled={busy || (!!w.address && (!addressOk || count > have || have === 0 || linksOff))}>
              {!w.address ? "Connect to send" : busy ? "Sending" : mode === "link" ? "Create claim link" : `Send ${count === 1 ? "the box" : `${count} boxes`}`}
            </button>
            {made ? (
              <div className="flex flex-col gap-2 rounded-[12px] border border-line-strong bg-panel-2 p-3 sm:flex-row sm:items-center">
                <code className="money min-w-0 flex-1 truncate text-[13px] text-cream">{made}</code>
                <button type="button" className="btn-ghost !min-h-[36px] !px-3 !py-2 text-[14px]" onClick={() => void navigator.clipboard.writeText(made)}>
                  Copy
                </button>
              </div>
            ) : null}
            <p role="status" className="min-h-[1.5em] text-[14px] text-cream">
              {status}
            </p>
          </div>
        </form>

        <div className="flex flex-col gap-4">
          <div className="rounded-[18px] border border-line bg-panel p-6 md:p-8">
            <p className="text-[15px] text-cream">What they see</p>
            <div className="mt-4 overflow-hidden rounded-[14px] border border-line-strong bg-panel-2">
              <img src={preview} alt={`Link preview: ${count} sealed ${machine.name} ${count === 1 ? "box" : "boxes"}${note.trim() ? `, with the note ${note.trim()}` : ""}.`} width={1200} height={630} className="block aspect-[1200/630] w-full bg-ink" />
            </div>
          </div>
          <MyGifts />
        </div>
      </div>
    </div>
  );
}

const STATE = ["", "Waiting to be claimed", "Claimed", "Taken back"];

function MyGifts() {
  const w = useWallet();
  const [links, setLinks] = useState<(SavedLink & { status: number })[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    if (!LINKS) return setLinks([]);
    const saved = loadSaved();
    const client = arcClient();
    const out = [];
    for (const l of saved) out.push({ ...l, status: (await readLink(client, BigInt(l.linkId)).catch(() => null))?.status ?? 0 });
    setLinks(out);
    setNow(Date.now() / 1000);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads link states from the chain
    void load();
  }, [load]);

  if (!LINKS || !links?.length) return null;
  return (
    <section aria-labelledby="my-gifts" className="rounded-[18px] border border-line bg-panel p-6 md:p-8">
      <h2 id="my-gifts" className="text-[18px]">
        My gifts
      </h2>
      <ul className="mt-4 grid gap-2">
        {links.map((l) => (
          <li key={l.linkId} className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-panel-2 p-3 text-[14px]">
            <span>
              <span className="money text-cream">{l.boxes}</span> {["", "Single", "Stack", "Vault"][l.machineId]} <span className="text-muted">{STATE[l.status] ?? ""}</span>
            </span>
            {l.status === 1 && now > l.expiresAt ? (
              <button
                type="button"
                className="btn-ghost !min-h-[34px] !px-3 !py-1.5 text-[13px]"
                onClick={() =>
                  void w
                    .send([reclaimLinkCall(BigInt(l.linkId))])
                    .then(() => (setMsg("The boxes are back in your wallet."), load()))
                    .catch((e: unknown) => setMsg(revertText(e)))
                }
              >
                Take back
              </button>
            ) : l.status === 1 ? (
              <button type="button" className="btn-ghost !min-h-[34px] !px-3 !py-1.5 text-[13px]" onClick={() => void navigator.clipboard.writeText(l.url)}>
                Copy link
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <p role="status" className="mt-3 min-h-[1.5em] text-[14px] text-cream">
        {msg}
      </p>
    </section>
  );
}
