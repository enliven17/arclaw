"use client";

/**
 * Your collection: what you hold now (every .arc stock, its live value, the total) with a way to sell back to USDC,
 * and every pack you have pulled. Holdings and prices are read from the chain; history from CardDrawn logs.
 *
 * Selling: quoteSell on the desk, a slippage floor, then approve (only if the allowance is short) and sell, sent
 * together. On testnet the desk is the mock desk; until it has sell(), selling says so instead of failing.
 */
/* eslint-disable @next/next/no-img-element -- small local SVG logos */
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { useWallet } from "@/components/wallet/WalletProvider";
import { arcClient } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { allowance, approveCall, pullsOf, quoteSell, readHoldings, revertText, sellCall, toUsdc, type Pull } from "@/lib/arclaw/contract";
import { getLenis } from "@/lib/motion";
import { logoOf, usdc } from "@/lib/stocks";
import { shareOnX } from "@/lib/share-client";
import { cn } from "@/lib/cn";

type Holding = Awaited<ReturnType<typeof readHoldings>>[number];

const shares = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 6 });
const valueOf = (h: Holding) => (Number(formatUnits(h.balance, 18)) * Number(h.priceUsd6)) / 1e6;

export function Collection() {
  const w = useWallet();
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [pulls, setPulls] = useState<Pull[] | null>(null);
  const [selling, setSelling] = useState<Holding | null>(null);

  const load = useCallback(async () => {
    if (!w.address) return;
    const client = arcClient();
    setHoldings(await readHoldings(client, w.address));
    setPulls(await pullsOf(client, w.address));
  }, [w.address]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the chain for the connected wallet
    void load();
  }, [load]);

  if (!ARC.contracts) return <Empty title="Not on this network yet" body="arclaw is not deployed on this network." />;
  if (!w.address) {
    return (
      <Empty title="Your collection" body="Connect to see the stocks you hold and every pack you have pulled.">
        <button type="button" className="btn-cream mt-6" onClick={w.openConnect}>
          Connect
        </button>
      </Empty>
    );
  }

  const held = (holdings ?? []).filter((h) => h.balance > 0n);
  const total = held.reduce((s, h) => s + valueOf(h), 0);

  return (
    <div className="wrap py-10 md:py-14">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <h1 className="h-section !text-[clamp(40px,5vw,80px)]">Your collection.</h1>
        <div className="md:text-right">
          <p className="text-[14px] text-muted">Worth now</p>
          <p className="money text-[clamp(32px,3.4vw,48px)] leading-none">{holdings ? `${usdc(total)} USDC` : "..."}</p>
        </div>
      </div>

      <section aria-labelledby="holdings-title" className="mt-10">
        <h2 id="holdings-title" className="text-[22px] tracking-[-0.01em]">
          Holdings
        </h2>
        {holdings === null ? (
          <p className="mt-4 text-[15px] text-muted">Reading your wallet</p>
        ) : held.length === 0 ? (
          <p className="mt-4 text-[15px] text-muted">No stocks yet. Open a box and they land here.</p>
        ) : (
          <ul className="mt-4 grid gap-2">
            {held.map((h) => {
              const logo = logoOf(h.ticker);
              return (
                <li key={h.ticker} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-[14px] border border-line bg-panel p-4 md:grid-cols-[auto_minmax(0,2fr)_1fr_1fr_auto]">
                  <span className="flex size-11 items-center justify-center rounded-[10px] border border-line bg-panel-2">{logo ? <img src={logo} alt={`${h.name} logo`} width={24} height={24} className="size-6" /> : null}</span>
                  <span className="min-w-0">
                    <span className="money block text-[17px]">{h.ticker}</span>
                    <span className="block truncate text-[13px] text-muted">{h.name}</span>
                  </span>
                  <span className="money hidden text-[15px] text-muted md:block">{shares(h.balance)} sh</span>
                  <span className="money hidden text-[16px] md:block">{usdc(valueOf(h))} USDC</span>
                  <span className="flex items-center gap-3">
                    <span className="money text-[15px] md:hidden">{usdc(valueOf(h))}</span>
                    <button type="button" className="btn-ghost !min-h-[38px] !px-4 !py-2 text-[14px]" onClick={() => setSelling(h)}>
                      Sell
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="pulls-title" className="mt-14">
        <h2 id="pulls-title" className="text-[22px] tracking-[-0.01em]">
          Every pack you pulled
        </h2>
        {pulls === null ? (
          <p className="mt-4 text-[15px] text-muted">Reading the chain</p>
        ) : pulls.length === 0 ? (
          <p className="mt-4 text-[15px] text-muted">Nothing pulled yet.</p>
        ) : (
          <ul className="mt-4 grid gap-2">
            {pulls.map((p) => {
              const sum = p.cards.reduce((s, c) => s + toUsdc(c.valueWei), 0);
              const big = p.tierName === "Legendary" || p.tierName === "Jackpot";
              return (
                <li key={p.key} className="flex flex-col gap-3 rounded-[14px] border border-line bg-panel p-4 md:flex-row md:items-center md:justify-between">
                  <span className={cn("text-[16px]", big ? "text-prize" : "text-cream")}>
                    {p.tierName} <span className="text-muted">{["", "Single", "Stack", "Vault"][p.machineId] ?? ""}</span>
                  </span>
                  <span className="money text-[14px] text-muted">{p.cards.map((c) => `${c.ticker} ${usdc(toUsdc(c.valueWei))}`).join("   ")}</span>
                  <span className="flex items-center gap-3">
                    <span className="money text-[16px]">{usdc(sum)} USDC</span>
                    <button
                      type="button"
                      className="btn-ghost !min-h-[36px] !px-3 !py-2 text-[13px]"
                      disabled={!p.txHash}
                      onClick={() => shareOnX(p.txHash!, p.boxIndex, `Pulled a ${p.tierName} pack on arclaw: ${usdc(sum)} USDC in real stocks.`)}
                    >
                      Share on X
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <SellSheet holding={selling} onClose={() => setSelling(null)} onSold={() => void load()} />
    </div>
  );
}

function Empty({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="wrap flex min-h-[60vh] flex-col items-start justify-center py-16">
      <h1 className="h-section !text-[clamp(40px,5vw,80px)]">{title}.</h1>
      <p className="lede mt-4 max-w-[28em]">{body}</p>
      {children}
    </div>
  );
}

const SLIPPAGE = [0.5, 1, 2];

function SellSheet({ holding, onClose, onSold }: { holding: Holding | null; onClose: () => void; onSold: () => void }) {
  const w = useWallet();
  const ref = useRef<HTMLDialogElement>(null);
  const [amount, setAmount] = useState("");
  const [slip, setSlip] = useState(1);
  const [quote, setQuote] = useState<{ out: bigint; ok: boolean } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (holding && !d.open) {
      setAmount(formatUnits(holding.balance, 18));
      setStatus(null);
      d.showModal();
      getLenis()?.stop();
    } else if (!holding && d.open) d.close();
  }, [holding]);

  const sharesIn = (() => {
    try {
      return amount ? parseUnits(amount, 18) : 0n;
    } catch {
      return 0n;
    }
  })();
  const tooMuch = holding ? sharesIn > holding.balance : false;

  useEffect(() => {
    if (!holding || sharesIn === 0n || tooMuch) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the quote when the input is not sellable
      setQuote(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => void quoteSell(arcClient(), holding.address, sharesIn).then((q) => live && setQuote(q)), 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [holding, sharesIn, tooMuch]);

  const minOut = quote ? (quote.out * BigInt(Math.round((100 - slip) * 100))) / 10_000n : 0n;

  const sell = async () => {
    if (!holding || !w.address || !quote?.ok) return;
    setBusy(true);
    setStatus(null);
    try {
      const desk = ARC.contracts!.sellDesk;
      const client = arcClient();
      const current = await allowance(client, holding.address, w.address as Address, desk);
      const calls = [...(current < sharesIn ? [approveCall(holding.address, desk, sharesIn)] : []), sellCall(holding.address, sharesIn, minOut, w.address as Address)];
      await w.send(calls);
      setStatus(`Sold. ${usdc(toUsdc(quote.out))} USDC is on its way to your wallet.`);
      onSold();
    } catch (e) {
      setStatus(revertText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={() => {
        getLenis()?.start();
        onClose();
      }}
      aria-labelledby="sell-title"
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-[18px] border border-line bg-panel p-0 text-cream backdrop:bg-ink/80 backdrop:backdrop-blur-sm"
    >
      {holding ? (
        <div className="p-6 md:p-7">
          <div className="flex items-start justify-between gap-4">
            <h2 id="sell-title" className="text-[28px] leading-tight tracking-[-0.02em]">
              Sell <span className="money">{holding.ticker}</span>
            </h2>
            <button type="button" className="btn-ghost !min-h-[36px] !px-3 !py-2 text-[14px]" onClick={() => ref.current?.close()}>
              Close
            </button>
          </div>
          <p className="mt-2 text-[14px] text-muted">
            You hold <span className="money text-cream">{shares(holding.balance)}</span> shares.
          </p>
          <label htmlFor="sell-amount" className="mt-5 block text-[14px] text-cream">
            Shares to sell
          </label>
          <div className="mt-2 flex gap-2">
            <input id="sell-amount" inputMode="decimal" className={cn("input money", tooMuch && "!border-cream")} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} aria-invalid={tooMuch || undefined} />
            <button type="button" className="btn-ghost shrink-0" onClick={() => setAmount(formatUnits(holding.balance, 18))}>
              Max
            </button>
          </div>
          <fieldset className="mt-4">
            <legend className="text-[14px] text-cream">Slippage</legend>
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-[12px] border border-line bg-panel-2 p-1">
              {SLIPPAGE.map((s) => (
                <button key={s} type="button" aria-pressed={slip === s} onClick={() => setSlip(s)} className={cn("money min-h-[38px] rounded-[9px] text-[14px]", slip === s ? "bg-cream text-ink" : "text-muted hover:text-cream")}>
                  {s}%
                </button>
              ))}
            </div>
          </fieldset>
          <dl className="mt-5 grid gap-2 border-t border-line pt-4 text-[14px]">
            <div className="flex justify-between">
              <dt className="text-muted">You get about</dt>
              <dd className="money text-cream">{quote ? `${usdc(toUsdc(quote.out))} USDC` : "..."}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">At least</dt>
              <dd className="money">{quote ? `${usdc(toUsdc(minOut))} USDC` : "..."}</dd>
            </div>
          </dl>
          {quote && !quote.ok ? <p className="mt-3 text-[14px] text-cream">{ARC.network === "testnet" ? "Selling opens on testnet once the test desk is updated." : "The desk cannot buy this back right now. Try a smaller amount or later."}</p> : null}
          <button type="button" className="btn mt-5 w-full" disabled={busy || !quote?.ok || tooMuch || sharesIn === 0n} onClick={() => void sell()}>
            {busy ? "Selling" : "Sell for USDC"}
          </button>
          <p role="status" className="mt-3 min-h-[1.5em] text-[14px] text-cream">
            {status}
          </p>
        </div>
      ) : null}
    </dialog>
  );
}
