"use client";

/**
 * Claim a gift link: /claim?m=<machine>&n=<boxes>&note=<note>#<link key>.
 *
 * The key after the # never leaves this browser. It co-signs the claim transaction your wallet sends, and a Solana
 * signature covers every account in the transaction, recipient included: a copy of the link seen by anyone else can
 * only ever deliver the boxes to the wallet that signed with it first.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { useWallet } from "@/components/wallet/WalletProvider";
import { SealedBox } from "@/components/pack/SealedBox";
import { variantOf } from "@/components/claw/view";
import { SOLANA } from "@/lib/solana/config";
import { baseConnection, errorText } from "@/lib/solana/client";
import { claimLinkIx, decodeLink, linkPda, type LinkAccount } from "@/lib/solana/program";
import { MACHINES } from "@/lib/machines";

function parseHash(): Keypair | null {
  const key = window.location.hash.slice(1);
  try {
    return Keypair.fromSecretKey(bs58.decode(key));
  } catch {
    return null;
  }
}

export function ClaimView({ machineSlug, boxes, note }: { machineSlug: string; boxes: number; note: string | null }) {
  const w = useWallet();
  const [link, setLink] = useState<Keypair | null | undefined>(undefined);
  const parsed = useRef<Keypair | null | undefined>(undefined);
  /** undefined while reading, null once the link account is gone (claimed or taken back). */
  const [state, setState] = useState<LinkAccount | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    // Kept in a ref: the effect can run twice (strict mode) and the hash is gone the second time.
    parsed.current ??= parseHash();
    setLink(parsed.current);
    // Read once, then off the address bar, so it is not left in history, screenshots or anything that reads the URL.
    if (window.location.hash) history.replaceState(history.state, "", window.location.pathname + window.location.search);
  }, []);

  const load = useCallback(async () => {
    if (!link || !SOLANA.deployment) return;
    const info = await baseConnection().getAccountInfo(linkPda(link.publicKey)).catch(() => null);
    setState(info ? decodeLink(info.data) : null);
    setNow(Date.now() / 1000);
  }, [link]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the link from the chain
    void load();
  }, [load]);

  const machine = MACHINES.find((m) => m.id === state?.machineId) ?? MACHINES.find((m) => m.slug === machineSlug) ?? MACHINES[0]!;
  const count = state?.boxes ?? boxes;
  const expired = state && now ? now > state.expiresAt : false;

  const claim = async () => {
    if (!link || !state) return;
    if (!w.sender) return w.openConnect();
    setBusy(true);
    setStatus(null);
    try {
      await w.sender.send(new Transaction().add(claimLinkIx(w.sender.publicKey, link.publicKey, state.sender)), [link]);
      setDone(true);
    } catch (e) {
      setStatus(errorText(e));
      void load();
    } finally {
      setBusy(false);
    }
  };

  const headline = done ? (count === 1 ? "The box is yours." : "The boxes are yours.") : count === 1 ? `A sealed ${machine.name} box for you.` : `${count} sealed ${machine.name} boxes for you.`;

  let body: React.ReactNode;
  if (link === undefined) body = null;
  else if (!link) body = <p className="lede">This link is not complete. Ask your friend to send it again.</p>;
  else if (done)
    body = (
      <a className="btn" href={`/app/play/${machine.slug}`}>
        Grab it with the claw
      </a>
    );
  else if (state === null) body = <p className="lede">This gift was already claimed, or the sender took it back.</p>;
  else if (expired) body = <p className="lede">This link has expired. Ask your friend for a new one.</p>;
  else
    body = (
      <div className="flex flex-col items-center gap-3">
        <button type="button" className="btn" disabled={busy || (!!w.address && !state)} onClick={() => void claim()}>
          {!w.address ? "Connect to claim" : busy ? "Claiming" : count === 1 ? "Claim the box" : `Claim ${count} boxes`}
        </button>
        <p className="max-w-[30em] text-[14px] leading-relaxed text-muted">The link&apos;s key signs your claim together with your wallet, so nobody else can take the box on the way.</p>
      </div>
    );

  return (
    <div className="wrap flex min-h-[calc(100dvh-56px)] flex-col items-center justify-center gap-8 py-16 text-center">
      <div className="w-[min(320px,70vw)]">
        <SealedBox variant={variantOf(machine.slug)} />
      </div>
      <h1 className="h-section !text-[clamp(36px,4.6vw,72px)] max-w-[14em]">{headline}</h1>
      {note && !done ? <p className="max-w-[28em] text-[20px] leading-snug text-cream">&ldquo;{note}&rdquo;</p> : null}
      {body}
      <p role="status" className="min-h-[1.5em] text-[14px] text-cream">
        {status}
      </p>
    </div>
  );
}
