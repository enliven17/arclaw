"use client";

/** The header's wallet button: Connect (opens Privy's modal), or the address with a small menu. */
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useWallet } from "./WalletProvider";

export const shortAddress = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

export function WalletButton({ className }: { className?: string }) {
  const w = useWallet();
  const [menu, setMenu] = useState(false);
  if (!w.address) {
    return (
      <button type="button" onClick={w.openConnect} disabled={w.connecting} className={cn("btn-cream !min-h-[36px] !px-3.5 !py-2 text-[14px]", className)}>
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
