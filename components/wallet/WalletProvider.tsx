"use client";

/**
 * One wallet for the app: any Solana wallet the browser has (Phantom, Solflare, Backpack and every other Wallet
 * Standard wallet are detected on their own), and on Android the Mobile Wallet Adapter, so the claw plays from a phone
 * with the wallet app the player already uses. The adapter reconnects the last wallet on reload.
 *
 * `useWallet()` gives the address, `openConnect()` (our own picker, styled like the rest of the app), disconnect, and
 * `sender`: sends a transaction on Solana and resolves once it is confirmed, or signs one for the rollup. Fees are SOL
 * from the wallet; boxes are paid in Circle's USDC.
 */
/* eslint-disable @next/next/no-img-element -- wallet icons are data URIs from the wallets themselves */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider as AdapterProvider, useConnection, useWallet as useAdapter } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { Transaction, type Keypair, type PublicKey } from "@solana/web3.js";
import { createDefaultAuthorizationCache, createDefaultChainSelector, createDefaultWalletNotFoundHandler, registerMwa } from "@solana-mobile/wallet-standard-mobile";
import { SOLANA } from "@/lib/solana/config";
import type { Sender } from "@/lib/solana/round";
import { getLenis } from "@/lib/motion";

type WalletState = {
  address: string | null;
  publicKey: PublicKey | null;
  /** Sends and signs; null until a wallet is connected. */
  sender: Sender | null;
  disconnect(): void;
  openConnect(): void;
};

const Ctx = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet needs <WalletProvider>");
  return v;
}

let mwaRegistered = false;
function registerMobile() {
  if (mwaRegistered || typeof window === "undefined") return;
  mwaRegistered = true;
  registerMwa({
    appIdentity: { name: "arclaw", uri: window.location.origin, icon: "/icon.svg" },
    authorizationCache: createDefaultAuthorizationCache(),
    chains: [SOLANA.network === "mainnet" ? "solana:mainnet" : "solana:devnet"],
    chainSelector: createDefaultChainSelector(),
    onWalletNotFound: createDefaultWalletNotFoundHandler(),
  });
}

function Inner({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const a = useAdapter();
  const [picker, setPicker] = useState(false);

  const send = useCallback(
    async (tx: Transaction, signers: Keypair[] = []) => {
      if (!a.publicKey) throw new Error("Connect a wallet first.");
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      tx.feePayer = a.publicKey;
      tx.recentBlockhash = blockhash;
      const signature = await a.sendTransaction(tx, connection, { signers, preflightCommitment: "confirmed" });
      const res = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      if (res.value.err) throw Object.assign(new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`), { signature });
      return signature;
    },
    [a, connection],
  );

  const sign = useCallback(
    async (tx: Transaction) => {
      if (!a.signTransaction) throw new Error("This wallet cannot sign transactions.");
      return a.signTransaction(tx);
    },
    [a],
  );

  const value = useMemo<WalletState>(
    () => ({
      address: a.publicKey?.toBase58() ?? null,
      publicKey: a.publicKey,
      sender: a.publicKey ? { publicKey: a.publicKey, send, sign } : null,
      disconnect: () => void a.disconnect(),
      openConnect: () => setPicker(true),
    }),
    [a, send, sign],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <Picker open={picker} onClose={() => setPicker(false)} />
    </Ctx.Provider>
  );
}

/** The wallet picker: installed wallets first, then the ones that can be installed. */
function Picker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const a = useAdapter();
  const ref = useRef<HTMLDialogElement>(null);
  const want = useRef<WalletName | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      getLenis()?.stop();
    } else if (!open && d.open) d.close();
  }, [open]);

  // Connect once the selection has landed in the adapter (select is async in effect).
  useEffect(() => {
    if (!want.current || a.wallet?.adapter.name !== want.current) return;
    want.current = null;
    void a.connect().then(onClose, () => undefined);
  }, [a, onClose]);

  const ready = a.wallets.filter((x) => x.readyState === WalletReadyState.Installed || x.readyState === WalletReadyState.Loadable);
  const others = a.wallets.filter((x) => x.readyState === WalletReadyState.NotDetected).slice(0, 4);

  return (
    <dialog
      ref={ref}
      onClose={() => {
        getLenis()?.start();
        onClose();
      }}
      aria-labelledby="wallet-title"
      className="m-auto w-[min(400px,calc(100vw-32px))] rounded-[18px] border border-line bg-panel p-0 text-cream backdrop:bg-ink/80 backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id="wallet-title" className="text-[26px] leading-tight tracking-[-0.02em]">
            Connect a wallet
          </h2>
          <button type="button" className="btn-ghost !min-h-[36px] !px-3 !py-2 text-[14px]" onClick={() => ref.current?.close()}>
            Close
          </button>
        </div>
        <p className="mt-2 text-[14px] text-muted">Any Solana wallet works. On a phone, your wallet app opens to approve.</p>
        <ul className="mt-5 grid gap-2">
          {ready.map((x) => (
            <li key={x.adapter.name}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-[12px] border border-line bg-panel-2 px-4 py-3 text-left text-[16px] hover:border-line-strong"
                onClick={() => {
                  want.current = x.adapter.name;
                  a.select(x.adapter.name);
                }}
              >
                <img src={x.adapter.icon} alt="" width={28} height={28} className="size-7 rounded-[6px]" />
                {x.adapter.name}
              </button>
            </li>
          ))}
          {ready.length === 0 ? <li className="text-[15px] text-muted">No Solana wallet found in this browser.</li> : null}
        </ul>
        {others.length ? (
          <p className="mt-5 text-[14px] text-muted">
            Get one:{" "}
            {others.map((x, i) => (
              <span key={x.adapter.name}>
                {i ? ", " : ""}
                <a className="text-cream underline underline-offset-4" href={x.adapter.url} target="_blank" rel="noreferrer">
                  {x.adapter.name}
                </a>
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </dialog>
  );
}

export function WalletProvider({ children }: { children: ReactNode }) {
  registerMobile();
  return (
    <ConnectionProvider endpoint={SOLANA.rpc} config={{ commitment: "confirmed" }}>
      <AdapterProvider wallets={[]} autoConnect>
        <Inner>{children}</Inner>
      </AdapterProvider>
    </ConnectionProvider>
  );
}
