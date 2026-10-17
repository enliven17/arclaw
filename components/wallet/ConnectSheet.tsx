"use client";

/**
 * The connect sheet: one dialog that offers both wallets. A passkey (Face ID, fingerprint or PIN, no extension, gas
 * covered) when the site has a Circle key, and a browser wallet when one is installed. Native <dialog>: focus is
 * trapped, Esc closes it. Also the header's wallet button.
 */
import { useEffect, useRef, useState } from "react";
import { getLenis } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { useWallet } from "./WalletProvider";

export const shortAddress = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

export function ConnectSheet() {
  const w = useWallet();
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (w.connectOpen && !d.open) {
      d.showModal();
      getLenis()?.stop();
    } else if (!w.connectOpen && d.open) d.close();
  }, [w.connectOpen]);

  return (
    <dialog
      ref={ref}
      onClose={() => {
        w.closeConnect();
        getLenis()?.start();
      }}
      aria-labelledby="connect-title"
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-[18px] border border-line bg-panel p-0 text-cream backdrop:bg-ink/80 backdrop:backdrop-blur-sm"
    >
      <div className="p-6 md:p-7">
        <div className="flex items-start justify-between gap-4">
          <h2 id="connect-title" className="text-[28px] leading-tight tracking-[-0.02em]">
            Connect
          </h2>
          <button type="button" onClick={w.closeConnect} className="btn-ghost !min-h-[36px] !px-3 !py-2 text-[14px]">
            Close
          </button>
        </div>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">Boxes and stocks go to the wallet you connect, on Arc.</p>

        {w.hasPasskey ? (
          <section className="mt-6 rounded-[14px] border border-line bg-panel-2 p-5" aria-labelledby="passkey-title">
            <h3 id="passkey-title" className="text-[18px]">
              Passkey
            </h3>
            <p className="mt-1 text-[14px] leading-relaxed text-muted">Face ID, fingerprint or PIN. No extension, and the gas is covered.</p>
            <label htmlFor="passkey-name" className="mt-4 block text-[14px] text-cream">
              Name for a new passkey
            </label>
            <input id="passkey-name" className="input mt-2" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="username webauthn" />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" className="btn-cream" disabled={w.connecting} onClick={() => void w.connectPasskey("create", name)}>
                Create
              </button>
              <button type="button" className="btn-ghost" disabled={w.connecting} onClick={() => void w.connectPasskey("login")}>
                I have one
              </button>
            </div>
          </section>
        ) : null}

        <section className={cn("rounded-[14px] border border-line bg-panel-2 p-5", w.hasPasskey ? "mt-3" : "mt-6")} aria-labelledby="injected-title">
          <h3 id="injected-title" className="text-[18px]">
            Browser wallet
          </h3>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">
            {w.hasInjected ? "MetaMask, Rabby or any wallet in this browser. You pay a little gas in USDC." : "No browser wallet found here. Install one, or use a passkey."}
          </p>
          <button type="button" className="btn-ghost mt-4 w-full" disabled={w.connecting || !w.hasInjected} onClick={() => void w.connectInjected()}>
            {w.connecting ? "Connecting" : "Connect browser wallet"}
          </button>
        </section>

        <p role="status" className="mt-4 min-h-[1.5em] text-[14px] text-cream">
          {w.error}
        </p>
      </div>
    </dialog>
  );
}

export function WalletButton({ className }: { className?: string }) {
  const w = useWallet();
  const [menu, setMenu] = useState(false);
  if (!w.address) {
    return (
      <button type="button" onClick={w.openConnect} className={cn("btn-cream !min-h-[36px] !px-3.5 !py-2 text-[14px]", className)}>
        Connect
      </button>
    );
  }
  return (
    <div className={cn("relative", className)}>
      <button type="button" onClick={() => setMenu((v) => !v)} aria-expanded={menu} className="btn-ghost money !min-h-[36px] !px-3.5 !py-2 text-[14px]">
        {shortAddress(w.address)}
      </button>
      {menu ? (
        <div className="absolute right-0 top-full z-10 mt-2 w-[220px] rounded-[14px] border border-line bg-panel p-2">
          <p className="px-3 py-2 text-[13px] text-muted">{w.kind === "passkey" ? "Passkey wallet" : "Browser wallet"}</p>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(w.address ?? "").then(() => setMenu(false))}
            className="w-full rounded-[10px] px-3 py-2 text-left text-[15px] hover:bg-panel-2"
          >
            Copy address
          </button>
          <button
            type="button"
            onClick={() => {
              w.disconnect();
              setMenu(false);
            }}
            className="w-full rounded-[10px] px-3 py-2 text-left text-[15px] hover:bg-panel-2"
          >
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}
