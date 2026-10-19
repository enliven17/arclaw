"use client";

/**
 * One wallet for the app: the user's own (MetaMask, Rabby, Coinbase, WalletConnect), connected through Family's
 * ConnectKit on wagmi. wagmi reconnects the last wallet on reload, so the address never changes behind the user.
 *
 * `useWallet()` gives the address, `openConnect()` (opens ConnectKit's modal), disconnect, and `send(calls)`, which
 * sends the calls one by one on Arc (switching first) and resolves with the last transaction hash once mined.
 * Gas is native USDC from the wallet's own balance; there is no paymaster.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider, getDefaultConfig, useModal } from "connectkit";
import { createConfig, useAccount, useConfig, useDisconnect, WagmiProvider } from "wagmi";
import { getWalletClient, switchChain } from "wagmi/actions";
import { getAddress, type Address, type Hex } from "viem";
import { ARC_CHAIN, arcClient, arcTransport, type Call } from "@/lib/arc/chain";
import { getLenis } from "@/lib/motion";

const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

type WalletState = {
  address: Address | null;
  /** True while wagmi reconnects the last wallet, or a connection is in progress. */
  connecting: boolean;
  disconnect(): void;
  send(calls: Call[]): Promise<Hex>;
  /** Opens ConnectKit's modal. */
  openConnect(): void;
};

const Ctx = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet needs <WalletProvider>");
  return v;
}

function Inner({ children }: { children: ReactNode }) {
  const config = useConfig();
  const { address, status } = useAccount();
  const { disconnect } = useDisconnect();
  const { open, setOpen } = useModal();

  // ConnectKit's modal is not ours: stop the smooth scroller behind it while it is open.
  useEffect(() => {
    if (open) getLenis()?.stop();
    else getLenis()?.start();
  }, [open]);

  const send = useCallback(
    async (calls: Call[]): Promise<Hex> => {
      if (!address) throw new Error("Connect a wallet first.");
      await switchChain(config, { chainId: ARC_CHAIN.id }).catch(() => undefined);
      const client = await getWalletClient(config, { chainId: ARC_CHAIN.id });
      const account = getAddress(address);
      const pub = arcClient();
      let last: Hex = "0x";
      for (const call of calls) {
        const tx = { to: call.to, data: call.data, value: call.value ?? 0n };
        // Gas and fees come from our own RPCs: a wallet whose saved Arc RPC is rate-limited then only has to sign.
        const [gas, fees] = await Promise.all([pub.estimateGas({ account, ...tx }), pub.estimateFeesPerGas()]);
        const hash = await client.sendTransaction({ ...tx, account, chain: ARC_CHAIN, gas: (gas * 12n) / 10n, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("The transaction reverted.");
        last = hash;
      }
      return last;
    },
    [address, config],
  );

  const value = useMemo<WalletState>(
    () => ({
      address: address ? getAddress(address) : null,
      connecting: status === "connecting" || status === "reconnecting",
      disconnect: () => disconnect(),
      send,
      openConnect: () => setOpen(true),
    }),
    [address, status, disconnect, send, setOpen],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// These mirror --color-panel, --color-cream and --color-ink in app/globals.css.
const THEME = {
  "--ck-font-family": "inherit",
  "--ck-body-background": "#141417",
  "--ck-body-color": "#ece6da",
  "--ck-primary-button-color": "#ece6da",
  "--ck-primary-button-border-radius": "12px",
  "--ck-border-radius": "18px",
  "--ck-overlay-background": "rgba(10,10,12,0.7)",
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state] = useState(() => ({
    query: new QueryClient(),
    wagmi: createConfig(
      getDefaultConfig({
        appName: "arclaw",
        appDescription: "Pay USDC on Arc, play a claw machine, win real stocks.",
        appIcon: "/brand/lockup.svg",
        // WalletConnect needs indexedDB, so it only starts in the browser, never during prerender.
        walletConnectProjectId: typeof window === "undefined" ? "" : WALLETCONNECT_PROJECT_ID,
        enableAaveAccount: false,
        chains: [ARC_CHAIN],
        transports: { [ARC_CHAIN.id]: arcTransport() },
        ssr: true,
      }),
    ),
  }));
  return (
    <WagmiProvider config={state.wagmi}>
      <QueryClientProvider client={state.query}>
        <ConnectKitProvider theme="midnight" customTheme={THEME} options={{ initialChainId: ARC_CHAIN.id, enforceSupportedChains: true }}>
          <Inner>{children}</Inner>
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
