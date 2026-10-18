"use client";

/**
 * One wallet for the app, through Privy and Privy's own login modal (email code, Google, X, or an external wallet):
 *   embedded  a Privy wallet (an EOA) made for the user on email or Google/X login
 *   external  a browser or mobile wallet (MetaMask, Rabby, Coinbase, WalletConnect) connected through Privy
 *
 * `useWallet()` gives the address, the kind, `openConnect()` (opens Privy's modal), disconnect, and `send(calls)`,
 * which sends the calls one by one on Arc (switching first) and resolves with the last transaction hash once mined.
 * Gas is native USDC from the wallet's own balance; there is no paymaster.
 *
 * Without NEXT_PUBLIC_PRIVY_APP_ID the app still runs: Privy never mounts and Connect says wallets are off.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  PrivyProvider,
  useConnectWallet,
  useLogin,
  useLogout,
  useModalStatus,
  usePrivy,
  useWallets,
  type ConnectedWallet,
  type PrivyClientConfig,
} from "@privy-io/react-auth";
import { createWalletClient, custom, getAddress, type Address, type Hex } from "viem";
import { ARC_CHAIN, arcClient, type Call } from "@/lib/arc/chain";
import { getLenis } from "@/lib/motion";

// Privy throws on anything but a 25 character app id; a malformed one counts as not configured instead of a crash.
const RAW_APP_ID = (process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "").trim();
const PRIVY_APP_ID = RAW_APP_ID.length === 25 ? RAW_APP_ID : "";
const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || undefined;
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || undefined;

export type WalletKind = "embedded" | "external";

type WalletState = {
  address: Address | null;
  kind: WalletKind | null;
  /** True until Privy is ready, and while a login's wallet is being made. */
  connecting: boolean;
  disconnect(): void;
  send(calls: Call[]): Promise<Hex>;
  /** Opens Privy's login modal. */
  openConnect(): void;
};

const Ctx = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet needs <WalletProvider>");
  return v;
}

/** The wallet the user last chose, so a stale external connection or an old login never takes over silently. */
type Choice = WalletKind | "off";
const CHOICE_KEY = "arclaw.wallet";
const readChoice = (): Choice | null => {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(CHOICE_KEY);
  return v === "embedded" || v === "external" || v === "off" ? v : null;
};
const writeChoice = (c: Choice) => {
  try {
    window.localStorage.setItem(CHOICE_KEY, c);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
};

const latestExternal = (wallets: ConnectedWallet[]) =>
  wallets.filter((w) => w.type === "ethereum" && w.walletClientType !== "privy").sort((a, b) => b.connectedAt - a.connectedAt)[0] ?? null;

function PrivyInner({ children }: { children: ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { logout } = useLogout();
  const [choice, setChoiceState] = useState<Choice | null>(readChoice);

  const choose = useCallback((c: Choice) => {
    writeChoice(c);
    setChoiceState(c);
  }, []);

  // Privy's modal is not ours: stop the smooth scroller behind it while it is open.
  const { isOpen } = useModalStatus();
  useEffect(() => {
    if (isOpen) getLenis()?.stop();
    else getLenis()?.start();
  }, [isOpen]);

  // Mounted on every app page, so a Google/X redirect completes wherever it lands. A wallet login is a SIWE login.
  const { login } = useLogin({ onComplete: ({ loginMethod }) => choose(loginMethod === "siwe" ? "external" : "embedded") });
  const { connectWallet } = useConnectWallet({ onSuccess: () => choose("external") });

  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? null;
  const external = latestExternal(wallets);
  // Embedded is the default choice: a logged-in user gets their Privy wallet.
  const active = choice === "off" ? null : choice === "external" ? external : authenticated ? embedded : null;
  const kind: WalletKind | null = active ? (active === embedded ? "embedded" : "external") : null;

  const openConnect = useCallback(() => {
    if (!authenticated) return login();
    // Logged in with a stale wallet choice: fall back to the login wallet, or offer the wallet list.
    if (embedded) return choose("embedded");
    connectWallet({ walletChainType: "ethereum-only", description: "" });
  }, [authenticated, choose, connectWallet, embedded, login]);

  const disconnect = useCallback(() => {
    choose("off");
    for (const w of wallets) if (w.walletClientType !== "privy") w.disconnect();
    if (authenticated) void logout();
  }, [authenticated, choose, logout, wallets]);

  const send = useCallback(
    async (calls: Call[]): Promise<Hex> => {
      if (!active) throw new Error("Connect a wallet first.");
      if (active.chainId !== `eip155:${ARC_CHAIN.id}`) await active.switchChain(ARC_CHAIN.id);
      // Asked for after the switch: a provider keeps the chain it was made on.
      const provider = await active.getEthereumProvider();
      const client = createWalletClient({ account: getAddress(active.address), chain: ARC_CHAIN, transport: custom(provider) });
      let last: Hex = "0x";
      for (const call of calls) {
        const hash = await client.sendTransaction({ to: call.to, data: call.data, value: call.value ?? 0n });
        const receipt = await arcClient().waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("The transaction reverted.");
        last = hash;
      }
      return last;
    },
    [active],
  );

  // Logged in but the embedded wallet is still being made.
  const creating = ready && authenticated && choice !== "off" && choice !== "external" && !embedded;
  const value = useMemo<WalletState>(
    () => ({ address: active ? getAddress(active.address) : null, kind, connecting: !ready || creating, disconnect, send, openConnect }),
    [active, kind, ready, creating, disconnect, send, openConnect],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const unconfigured: WalletState = {
  address: null,
  kind: null,
  connecting: false,
  disconnect: () => undefined,
  send: async () => {
    throw new Error("Wallets are not configured.");
  },
  openConnect: () => window.alert("Wallets are not configured on this site yet (NEXT_PUBLIC_PRIVY_APP_ID)."),
};

// Privy only takes hex colours: these mirror --color-panel and --color-cream in app/globals.css.
const PRIVY_CONFIG: PrivyClientConfig = {
  appearance: {
    theme: "#141417",
    accentColor: "#ece6da",
    logo: "/brand/lockup.svg",
    landingHeader: "Connect",
    loginMessage: "Boxes and stocks go to the wallet you connect, on Arc.",
    showWalletLoginFirst: false,
    walletChainType: "ethereum-only",
    walletList: ["detected_ethereum_wallets", "metamask", "coinbase_wallet", "rainbow", "wallet_connect"],
  },
  loginMethods: ["email", "google", "twitter", "wallet"],
  defaultChain: ARC_CHAIN,
  supportedChains: [ARC_CHAIN],
  embeddedWallets: {
    ethereum: { createOnLogin: "all-users" },
    // The play screen is the confirmation; Privy's own transaction prompt would be a second one.
    showWalletUIs: false,
  },
  legal: { privacyPolicyUrl: "/privacy", termsAndConditionsUrl: "/disclaimer" },
  ...(WALLETCONNECT_PROJECT_ID ? { walletConnectCloudProjectId: WALLETCONNECT_PROJECT_ID } : {}),
};

export function WalletProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <Ctx.Provider value={unconfigured}>{children}</Ctx.Provider>;
  return (
    <PrivyProvider appId={PRIVY_APP_ID} clientId={PRIVY_CLIENT_ID} config={PRIVY_CONFIG}>
      <PrivyInner>{children}</PrivyInner>
    </PrivyProvider>
  );
}
