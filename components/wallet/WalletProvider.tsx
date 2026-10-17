"use client";

/**
 * One wallet for the app, whichever kind the user picks:
 *   injected  a browser wallet through wagmi (MetaMask, Rabby, Coinbase extension, any EIP-1193 provider)
 *   passkey   a Circle smart account owned by a passkey (lib/arc/account.ts, loaded on demand)
 *
 * `useWallet()` gives the address, the kind, connect and disconnect, and `send(calls)`, which runs the calls and
 * resolves with the last transaction hash once mined. A browser wallet sends them one by one (switching to Arc
 * first); the passkey wallet sends them as one sponsored user operation.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, useConnection, useConnect, useDisconnect, useConnectors } from "wagmi";
import { injected } from "wagmi/connectors";
import { getConnection, sendTransaction, switchChain, waitForTransactionReceipt } from "wagmi/actions";
import type { Address, Hex } from "viem";
import { ARC_CHAIN, arcTransport } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import type { Call, PasskeySession } from "@/lib/arc/account";
import { loadPasskeyAccount } from "@/lib/arc/lazy";

export const wagmiConfig = createConfig({
  chains: [ARC_CHAIN],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [ARC_CHAIN.id]: arcTransport() },
  ssr: true,
});

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } } });

export type WalletKind = "injected" | "passkey";

type WalletState = {
  address: Address | null;
  kind: WalletKind | null;
  connecting: boolean;
  error: string | null;
  /** True when a browser wallet is present to connect to. */
  hasInjected: boolean;
  /** True when the site has a Circle client key, so passkeys can be offered. */
  hasPasskey: boolean;
  connectInjected(): Promise<void>;
  connectPasskey(mode: "create" | "login", name?: string): Promise<void>;
  disconnect(): void;
  send(calls: Call[]): Promise<Hex>;
  /** Open the connect sheet (rendered by <ConnectSheet />). */
  openConnect(): void;
  closeConnect(): void;
  connectOpen: boolean;
};

const Ctx = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet needs <WalletProvider>");
  return v;
}

const errorText = (e: unknown) => {
  const m = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
  if (/reject|denied|cancel/i.test(m)) return "You cancelled it in your wallet.";
  if (/NotAllowedError|timed out|not allowed/i.test(m)) return "The passkey prompt was closed.";
  return m.length > 160 ? `${m.slice(0, 157)}...` : m;
};

function Inner({ children }: { children: ReactNode }) {
  const conn = useConnection();
  const { connectAsync } = useConnect();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const connectors = useConnectors();
  const [passkey, setPasskey] = useState<PasskeySession | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [hasInjected, setHasInjected] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window.ethereum only exists in the browser.
    setHasInjected(typeof window !== "undefined" && Boolean((window as { ethereum?: unknown }).ethereum));
  }, []);

  // Restore a passkey session from the stored public credential (no prompt until something is signed).
  useEffect(() => {
    if (!ARC.circle.clientKey) return;
    let live = true;
    void loadPasskeyAccount().then(async (m) => {
      const stored = m.loadStoredPasskey();
      if (!stored || !live) return;
      try {
        const s = await m.openSession(stored);
        if (live) setPasskey(s);
      } catch {
        // A stale entry: the user logs in again from the sheet.
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const connectInjected = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const c = connectors.find((x) => x.type === "injected") ?? connectors[0];
      if (!c) throw new Error("No browser wallet found.");
      await connectAsync({ connector: c, chainId: ARC_CHAIN.id });
      setPasskey(null);
      setConnectOpen(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setConnecting(false);
    }
  }, [connectAsync, connectors]);

  const connectPasskey = useCallback(
    async (mode: "create" | "login", name?: string) => {
      setError(null);
      setConnecting(true);
      try {
        const m = await loadPasskeyAccount();
        const s = mode === "create" ? await m.createPasskey(name?.trim() || `arclaw ${new Date().toISOString().slice(0, 10)}`) : await m.loginPasskey();
        if (conn.status === "connected") wagmiDisconnect();
        setPasskey(s);
        setConnectOpen(false);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setConnecting(false);
      }
    },
    [conn.status, wagmiDisconnect],
  );

  const disconnect = useCallback(() => {
    if (passkey) {
      void loadPasskeyAccount().then((m) => m.clearStoredPasskey());
      setPasskey(null);
    }
    wagmiDisconnect();
  }, [passkey, wagmiDisconnect]);

  const send = useCallback(
    async (calls: Call[]): Promise<Hex> => {
      if (passkey) return passkey.sendCalls(calls);
      const c = getConnection(wagmiConfig);
      if (c.status !== "connected") throw new Error("Connect a wallet first.");
      if (c.chainId !== ARC_CHAIN.id) await switchChain(wagmiConfig, { chainId: ARC_CHAIN.id });
      let last: Hex = "0x";
      for (const call of calls) {
        const hash = await sendTransaction(wagmiConfig, { to: call.to, data: call.data, value: call.value ?? 0n, chainId: ARC_CHAIN.id });
        const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: ARC_CHAIN.id });
        if (receipt.status !== "success") throw new Error("The transaction reverted.");
        last = hash;
      }
      return last;
    },
    [passkey],
  );

  const value = useMemo<WalletState>(
    () => ({
      address: passkey?.address ?? (conn.status === "connected" ? conn.address : null),
      kind: passkey ? "passkey" : conn.status === "connected" ? "injected" : null,
      connecting,
      error,
      hasInjected,
      hasPasskey: Boolean(ARC.circle.clientKey),
      connectInjected,
      connectPasskey,
      disconnect,
      send,
      openConnect: () => {
        setError(null);
        setConnectOpen(true);
      },
      closeConnect: () => setConnectOpen(false),
      connectOpen,
    }),
    [passkey, conn.status, conn.address, connecting, error, hasInjected, connectInjected, connectPasskey, disconnect, send, connectOpen],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Inner>{children}</Inner>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
