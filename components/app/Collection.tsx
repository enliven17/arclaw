"use client";

/**
 * Your collection: what you hold now (every listed stock token, its value, the total) and every pack you have pulled.
 * Holdings are read from your token accounts (Token and Token-2022); history from the RoundSettled events of your
 * Player account's transactions.
 *
 * Selling: on mainnet the stocks are xStocks, which trade against USDC on Jupiter, so Sell opens a Jupiter swap for
 * that mint. Devnet stocks are test mints with no market.
 */
/* eslint-disable @next/next/no-img-element -- small local SVG logos */
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { SOLANA } from "@/lib/solana/config";
import { pullsOf, readHoldings, type Pull } from "@/lib/solana/client";
import { logoOf, usdc } from "@/lib/stocks";
import { shareOnX } from "@/lib/share-client";
import { cn } from "@/lib/cn";

type Holding = Awaited<ReturnType<typeof readHoldings>>[number];

const shares = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 6 });
const sellUrl = (mint: string) => `https://jup.ag/swap/${mint}-USDC`;

export function Collection() {
  const w = useWallet();
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [pulls, setPulls] = useState<Pull[] | null>(null);

  const load = useCallback(async () => {
    if (!w.publicKey) return;
    setHoldings(await readHoldings(w.publicKey).catch(() => []));
    setPulls(await pullsOf(w.publicKey).catch(() => []));
  }, [w.publicKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the chain for the connected wallet
    void load();
  }, [load]);

  if (!SOLANA.deployment) return <Empty title="Not on this network yet" body="arclaw is not deployed on this network." />;
  if (!w.address) {
    return (
      <Empty title="Your collection" body="Connect to see the stocks you hold and every pack you have pulled.">
        <button type="button" className="btn-cream mt-6" onClick={w.openConnect}>
          Connect
        </button>
      </Empty>
    );
  }

  const held = (holdings ?? []).filter((h) => h.shares > 0);
  const total = held.reduce((s, h) => s + h.value, 0);
  const mainnet = SOLANA.network === "mainnet";

  return (
    <div className="wrap py-10 md:py-14">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <h1 className="h-section !text-[clamp(40px,5vw,80px)]">Your collection.</h1>
        <div className="md:text-right">
          <p className="text-[14px] text-muted">Worth about</p>
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
          <p className="mt-4 text-[15px] text-muted">No stocks yet. Grab a box and they land here.</p>
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
                  <span className="money hidden text-[15px] text-muted md:block">{shares(h.shares)} sh</span>
                  <span className="money hidden text-[16px] md:block">{usdc(h.value)} USDC</span>
                  <span className="flex items-center gap-3">
                    <span className="money text-[15px] md:hidden">{usdc(h.value)}</span>
                    {mainnet ? (
                      <a className="btn-ghost !min-h-[38px] !px-4 !py-2 text-[14px]" href={sellUrl(h.mint)} target="_blank" rel="noreferrer">
                        Sell
                      </a>
                    ) : (
                      <span className="text-[13px] text-muted">Test stock</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {mainnet && held.length ? <p className="mt-3 text-[13px] text-muted">Selling opens a USDC swap on Jupiter in a new tab.</p> : null}
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
              const big = p.tierName === "Legendary" || p.tierName === "Jackpot";
              return (
                <li key={p.key} className="flex flex-col gap-3 rounded-[14px] border border-line bg-panel p-4 md:flex-row md:items-center md:justify-between">
                  <span className={cn("text-[16px]", big ? "text-prize" : "text-cream")}>
                    {p.tierName} <span className="text-muted">{["", "Single", "Stack", "Vault"][p.machineId] ?? ""}</span>
                  </span>
                  <span className="money text-[14px] text-muted">{p.cards.map((c) => `${c.ticker} ${usdc(c.valueUsdc)}`).join("   ")}</span>
                  <span className="flex items-center gap-3">
                    <span className="money text-[16px]">{usdc(p.valueUsdc)} USDC</span>
                    <button
                      type="button"
                      className="btn-ghost !min-h-[36px] !px-3 !py-2 text-[13px]"
                      disabled={!p.signature}
                      onClick={() => shareOnX(p.signature!, `Pulled a ${p.tierName} pack on arclaw: ${usdc(p.valueUsdc)} USDC in real stocks.`)}
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
