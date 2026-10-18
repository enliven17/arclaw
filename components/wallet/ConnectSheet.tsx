"use client";

/**
 * The connect sheet: one dialog, our own UI over Privy's headless hooks. Email (a one-time code), Google or X log in
 * and get a Privy wallet; "Connect a wallet" hands over to Privy's wallet list for MetaMask, Rabby, Coinbase or
 * WalletConnect. Native <dialog>: focus is trapped, Esc closes it. Also the header's wallet button.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { getLenis } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { useWallet } from "./WalletProvider";

export const shortAddress = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

const PANEL = "rounded-[14px] border border-line bg-panel-2 p-5";

function EmailCode() {
  const w = useWallet();
  const [code, setCode] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim()) void w.loginWithEmailCode(code);
  };
  return (
    <form onSubmit={submit} className="mt-4">
      <label htmlFor="email-code" className="block text-[14px] text-cream">
        Code sent to {w.emailSentTo}
      </label>
      <input
        id="email-code"
        className="input money mt-2"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoFocus
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="submit" className="btn-cream" disabled={w.connecting || !code.trim()}>
          {w.connecting ? "Checking" : "Log in"}
        </button>
        <button type="button" className="btn-ghost" disabled={w.connecting} onClick={w.resetEmail}>
          Other email
        </button>
      </div>
    </form>
  );
}

function EmailAddress() {
  const w = useWallet();
  const [email, setEmail] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (email.trim()) void w.sendEmailCode(email);
  };
  return (
    <form onSubmit={submit} className="mt-4">
      <label htmlFor="email-address" className="block text-[14px] text-cream">
        Email
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="email-address"
          type="email"
          className="input min-w-0 flex-1"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button type="submit" className="btn-cream shrink-0" disabled={w.connecting || !email.trim()}>
          Send code
        </button>
      </div>
    </form>
  );
}

function Options() {
  const w = useWallet();
  return (
    <>
      <section className={cn(PANEL, "mt-6")} aria-labelledby="login-title">
        <h3 id="login-title" className="text-[18px]">
          Log in
        </h3>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">We make you a wallet. Add USDC on Arc to play; gas is paid in USDC too.</p>
        {w.emailStep === "code" ? <EmailCode /> : <EmailAddress />}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className="btn-ghost" disabled={w.connecting} onClick={() => void w.connectSocial("google")}>
            Google
          </button>
          <button type="button" className="btn-ghost" disabled={w.connecting} onClick={() => void w.connectSocial("twitter")}>
            X
          </button>
        </div>
      </section>

      <section className={cn(PANEL, "mt-3")} aria-labelledby="external-title">
        <h3 id="external-title" className="text-[18px]">
          Your own wallet
        </h3>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">MetaMask, Rabby, Coinbase or WalletConnect. You pay a little gas in USDC.</p>
        <button type="button" className="btn-ghost mt-4 w-full" disabled={w.connecting} onClick={w.connectExternal}>
          Connect a wallet
        </button>
      </section>
    </>
  );
}

export function ConnectSheet() {
  const w = useWallet();
  const ref = useRef<HTMLDialogElement>(null);

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

        {w.configured ? <Options /> : <p className={cn(PANEL, "mt-6 text-[14px] leading-relaxed text-muted")}>Wallets are not configured on this site yet.</p>}

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
          <p className="px-3 py-2 text-[13px] text-muted">{w.kind === "embedded" ? "Login wallet" : "Your own wallet"}</p>
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
