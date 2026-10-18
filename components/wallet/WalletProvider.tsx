"use client";

/**
 * One wallet for the app, through Privy, headless (our own connect sheet, no Privy login modal):
 *   embedded  a Privy wallet (an EOA) made for the user on email or Google/X login
 *   external  a browser or mobile wallet (MetaMask, Rabby, Coinbase, WalletConnect) connected through Privy
 *
 * `useWallet()` gives the address, the kind, the connect flows, disconnect, and `send(calls)`, which sends the calls
 * one by one on Arc (switching first) and resolves with the last transaction hash once mined. Gas is native USDC
 * from the wallet's own balance; there is no paymaster.
 *
 * Without NEXT_PUBLIC_PRIVY_APP_ID the app still runs: Privy never mounts and the sheet says wallets are off.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  Captcha,
  PrivyProvider,
  useConnectWallet,
  useLoginWithEmail,
  useLoginWithOAuth,
  useLogout,
  usePrivy,
  useWallets,
  type ConnectedWallet,
  type PrivyErrorCode,
  type PrivyClientConfig,
} from "@privy-io/react-auth";
import { createWalletClient, custom, getAddress, type Address, type Hex } from "viem";
import { ARC_CHAIN, arcClient, type Call } from "@/lib/arc/chain";

// Privy throws on anything but a 25 character app id; a malformed one counts as not configured instead of a crash.
const RAW_APP_ID = (process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "").trim();
const PRIVY_APP_ID = RAW_APP_ID.length === 25 ? RAW_APP_ID : "";
const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID || undefined;
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || undefined;

export type WalletKind = "embedded" | "external";
export type SocialProvider = "google" | "twitter";
export type EmailStep = "email" | "code";

type WalletState = {
  address: Address | null;
  kind: WalletKind | null;
  connecting: boolean;
  error: string | null;
  /** False when the site has no Privy app id: the sheet shows a note instead of the options. */
  configured: boolean;
  /** Email login: "email" asks for the address, "code" for the one-time code that was sent to it. */
  emailStep: EmailStep;
  emailSentTo: string | null;
  sendEmailCode(email: string): Promise<void>;
  loginWithEmailCode(code: string): Promise<void>;
  /** Back from the code step to the email step. */
  resetEmail(): void;
  /** Redirects to Google or X and back; the embedded wallet is made on return. */
  connectSocial(provider: SocialProvider): Promise<void>;
  /** Closes our sheet and opens Privy's wallet list (MetaMask, Rabby, Coinbase, WalletConnect). */
  connectExternal(): void;
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

// PrivyErrorCode is a type-only export at runtime, so its values are matched as strings.
const CODE_TEXT: Record<string, string> = {
  invalid_credentials: "That code did not work. Check it and try again.",
  too_many_requests: "Too many tries. Wait a minute and try again.",
  oauth_user_denied: "The login was cancelled.",
  disallowed_login_method: "That way of logging in is not turned on yet.",
  captcha_failure: "The bot check failed. Try again.",
  captcha_timeout: "The bot check timed out. Try again.",
  embedded_wallet_create_error: "Your wallet could not be made. Try again.",
};
const codeText = (code: PrivyErrorCode | string) => CODE_TEXT[String(code)] ?? "Something went wrong. Try again.";

const errorText = (e: unknown) => {
  const code = (e as { privyErrorCode?: PrivyErrorCode } | null)?.privyErrorCode;
  if (code) return codeText(code);
  const m = e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
  if (/reject|denied|cancel/i.test(m)) return "You cancelled it in your wallet.";
  return m.length > 160 ? `${m.slice(0, 157)}...` : m;
};

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

/** Sheet state shared by the live and the unconfigured providers. */
function useSheet() {
  const [connectOpen, setConnectOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openConnect = useCallback(() => {
    setError(null);
    setConnectOpen(true);
  }, []);
  const closeConnect = useCallback(() => setConnectOpen(false), []);
  return { connectOpen, setConnectOpen, error, setError, openConnect, closeConnect };
}

const latestExternal = (wallets: ConnectedWallet[]) =>
  wallets.filter((w) => w.type === "ethereum" && w.walletClientType !== "privy").sort((a, b) => b.connectedAt - a.connectedAt)[0] ?? null;

function PrivyInner({ children }: { children: ReactNode }) {
  const { connectOpen, setConnectOpen, error, setError, openConnect, closeConnect } = useSheet();
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { logout } = useLogout();
  const [choice, setChoiceState] = useState<Choice | null>(readChoice);
  const [busy, setBusy] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);

  const choose = useCallback((c: Choice) => {
    writeChoice(c);
    setChoiceState(c);
  }, []);

  const onLogin = useMemo(
    () => ({
      onComplete: () => {
        choose("embedded");
        setEmailSentTo(null);
        setConnectOpen(false);
      },
      onError: (code: PrivyErrorCode) => {
        if (String(code) !== "exited_auth_flow") setError(codeText(code));
      },
    }),
    [choose, setConnectOpen, setError],
  );
  const email = useLoginWithEmail(onLogin);
  // Mounted on every app page so the Google/X redirect completes wherever it lands.
  const oauth = useLoginWithOAuth(onLogin);
  const { connectWallet } = useConnectWallet({
    onSuccess: () => {
      choose("external");
      setBusy(false);
    },
    onError: (code) => {
      setBusy(false);
      // Closing Privy's wallet list is not an error worth a message.
      if (["exited_auth_flow", "generic_connect_wallet_error"].includes(String(code))) return;
      setError(codeText(code));
      setConnectOpen(true);
    },
  });

  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? null;
  const external = latestExternal(wallets);
  // Embedded is the default choice: a logged-in user gets their Privy wallet.
  const active = choice === "off" ? null : choice === "external" ? external : authenticated ? embedded : null;
  const kind: WalletKind | null = active ? (active === embedded ? "embedded" : "external") : null;

  const sendEmailCode = useCallback(
    async (address: string) => {
      setError(null);
      const trimmed = address.trim();
      try {
        await email.sendCode({ email: trimmed });
        setEmailSentTo(trimmed);
      } catch (e) {
        setError(errorText(e));
      }
    },
    [email, setError],
  );

  const loginWithEmailCode = useCallback(
    async (code: string) => {
      setError(null);
      try {
        await email.loginWithCode({ code: code.trim() });
      } catch (e) {
        setError(errorText(e));
      }
    },
    [email, setError],
  );

  const connectSocial = useCallback(
    async (provider: SocialProvider) => {
      setError(null);
      try {
        // Stored before the redirect: the login completes on a fresh page load.
        choose("embedded");
        await oauth.initOAuth({ provider });
      } catch (e) {
        setError(errorText(e));
      }
    },
    [choose, oauth, setError],
  );

  const connectExternal = useCallback(() => {
    setError(null);
    // Our sheet is a modal <dialog> in the top layer; Privy's wallet list must not open underneath it.
    setConnectOpen(false);
    setBusy(true);
    connectWallet({ walletChainType: "ethereum-only", description: "" });
  }, [connectWallet, setConnectOpen, setError]);

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

  const emailBusy = email.state.status === "sending-code" || email.state.status === "submitting-code";
  // Logged in but the embedded wallet is still being made.
  const creating = ready && authenticated && choice !== "off" && choice !== "external" && !embedded;
  const value = useMemo<WalletState>(
    () => ({
      address: active ? getAddress(active.address) : null,
      kind,
      connecting: !ready || busy || emailBusy || oauth.loading || creating,
      error,
      configured: true,
      emailStep: emailSentTo ? "code" : "email",
      emailSentTo,
      sendEmailCode,
      loginWithEmailCode,
      resetEmail: () => {
        setError(null);
        setEmailSentTo(null);
      },
      connectSocial,
      connectExternal,
      disconnect,
      send,
      openConnect,
      closeConnect,
      connectOpen,
    }),
    [active, kind, ready, busy, emailBusy, oauth.loading, creating, error, openConnect, closeConnect, connectOpen, emailSentTo, sendEmailCode, loginWithEmailCode, setError, connectSocial, connectExternal, disconnect, send],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Invisible; only does anything when bot protection is on in the Privy dashboard. */}
      {connectOpen ? <Captcha /> : null}
    </Ctx.Provider>
  );
}

const notConfigured = async () => {
  throw new Error("Wallets are not configured.");
};

function UnconfiguredInner({ children }: { children: ReactNode }) {
  const { connectOpen, error, openConnect, closeConnect } = useSheet();
  const value = useMemo<WalletState>(
    () => ({
      address: null,
      kind: null,
      connecting: false,
      error,
      configured: false,
      emailStep: "email",
      emailSentTo: null,
      sendEmailCode: notConfigured,
      loginWithEmailCode: notConfigured,
      resetEmail: () => undefined,
      connectSocial: notConfigured,
      connectExternal: () => undefined,
      disconnect: () => undefined,
      send: notConfigured,
      openConnect,
      closeConnect,
      connectOpen,
    }),
    [connectOpen, error, openConnect, closeConnect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Privy only takes hex colours: these mirror --color-panel and --color-cream in app/globals.css.
const PRIVY_CONFIG: PrivyClientConfig = {
  appearance: {
    theme: "#141417",
    accentColor: "#ece6da",
    landingHeader: "Connect a wallet",
    showWalletLoginFirst: true,
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
  if (!PRIVY_APP_ID) return <UnconfiguredInner>{children}</UnconfiguredInner>;
  return (
    <PrivyProvider appId={PRIVY_APP_ID} clientId={PRIVY_CLIENT_ID} config={PRIVY_CONFIG}>
      <PrivyInner>{children}</PrivyInner>
    </PrivyProvider>
  );
}
