"use client";

/**
 * Claim a gift link: /claim?m=<machine>&n=<boxes>&note=<note>#<key>&<linkId>.
 *
 * The key after the # never leaves this browser. It signs claimDigest(linkId, yourAddress) here, and your wallet sends
 * claimLink(linkId, yourAddress, signature): a copy of the link seen by anyone else can only ever deliver the boxes to
 * the address the key signed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useWallet } from "@/components/wallet/WalletProvider";
import { SealedBox } from "@/components/pack/SealedBox";
import { variantOf } from "@/components/claw/view";
import { arcClient } from "@/lib/arc/chain";
import { LINKS, claimDigest, claimLinkCall, readLink, type LinkState } from "@/lib/arclaw/contract";
import { MACHINES } from "@/lib/machines";

type Parsed = { key: Hex; linkId: bigint } | null;

function parseHash(): Parsed {
  const [key, id] = window.location.hash.slice(1).split("&");
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key) || !id || !/^\d+$/.test(id)) return null;
  return { key: key as Hex, linkId: BigInt(id) };
}

export function ClaimView({ machineSlug, boxes, note }: { machineSlug: string; boxes: number; note: string | null }) {
  const w = useWallet();
  const [link, setLink] = useState<Parsed | undefined>(undefined);
  const parsed = useRef<Parsed | undefined>(undefined);
  const [state, setState] = useState<LinkState | null>(null);
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
    if (!link || !LINKS) return;
    setState(await readLink(arcClient(), link.linkId).catch(() => null));
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
    if (!link) return;
    if (!w.address) return w.openConnect();
    setBusy(true);
    setStatus(null);
    try {
      const digest = await claimDigest(arcClient(), link.linkId, w.address as Address);
      const signature = await privateKeyToAccount(link.key).sign({ hash: digest });
      await w.send([claimLinkCall(link.linkId, w.address as Address, signature)]);
      setDone(true);
      void load();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "The claim did not go through.");
    } finally {
      setBusy(false);
    }
  };

  const headline = done ? (count === 1 ? "The box is yours." : "The boxes are yours.") : count === 1 ? `A sealed ${machine.name} box for you.` : `${count} sealed ${machine.name} boxes for you.`;

  let body: React.ReactNode;
  if (link === undefined) body = null;
  else if (!link) body = <p className="lede">This link is not complete. Ask your friend to send it again.</p>;
  else if (!LINKS) body = <p className="lede">Claim links open after the next contract update. Keep this link; it will work then.</p>;
  else if (done)
    body = (
      <a className="btn" href={`/app/play/${machine.slug}`}>
        Open it
      </a>
    );
  else if (state && state.status === 2) body = <p className="lede">This gift was already claimed.</p>;
  else if (state && state.status === 3) body = <p className="lede">The sender took these boxes back.</p>;
  else if (expired) body = <p className="lede">This link has expired. Ask your friend for a new one.</p>;
  else
    body = (
      <div className="flex flex-col items-center gap-3">
        <button type="button" className="btn" disabled={busy || (!!w.address && !state)} onClick={() => void claim()}>
          {!w.address ? "Connect to claim" : busy ? "Claiming" : count === 1 ? "Claim the box" : `Claim ${count} boxes`}
        </button>
        <p className="max-w-[30em] text-[14px] leading-relaxed text-muted">Claiming signs your own address with the link&apos;s key, so nobody else can take the box on the way.</p>
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
