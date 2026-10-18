"use client";

/**
 * Inside a machine: the cabinet, big, and its control panel.
 *
 *   Play    pays boxes * price in one transaction. The claw starts on submit (coin, travel, drop) and holds; once the
 *           payment confirms it grips, lifts and drops the box down the chute, then a fresh box lands on the pile.
 *   Open    burns sealed boxes and asks the VRF for a draw (the house covers its fee). When the draw is in, the app
 *           sends the reveal as a second transaction and the full-screen reveal plays. If the draw expires, the
 *           opener can ask again or take the boxes back.
 *
 * The first play asks for the 18+ and risk acknowledgement, kept in localStorage.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { ClawMachine, type ClawHandle } from "@/components/claw/ClawMachine";
import type { ClawArt } from "@/components/claw/geometry";
import { useWallet } from "@/components/wallet/WalletProvider";
import { RevealOverlay, type RevealWaiting } from "./RevealOverlay";
import { CabinetMorph } from "@/components/motion/PageTransitions";
import { arcClient } from "@/lib/arc/chain";
import { explorerTx } from "@/lib/arc/config";
import {
  STATUS,
  VRF_EXPIRY_S,
  boxesFromLogs,
  openCall,
  readTableId,
  revertText,
  openingFromLogs,
  playCall,
  readBoxes,
  readOpening,
  retryCall,
  returnBoxesCall,
  revealCall,
  revealedBoxes,
  vrfTopUp,
  type DrawnBox,
} from "@/lib/arclaw/contract";
import { fmtMultiplier, fmtPct, type Machine } from "@/lib/machines";
import { useMachineStatus } from "./useMachineStatus";
import { usdc } from "@/lib/stocks";
import { cn } from "@/lib/cn";

const ACK_KEY = "arclaw:ack-18";
const MAX_OPEN = 20;
const GRIP_AT = 3.4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function MachineRoom({ art, machine }: { art: ClawArt; machine: Machine }) {
  const w = useWallet();
  const status = useMachineStatus(machine.id);
  // Off and paused are not the player's to fix; a stale table is the keeper's, and clears in seconds.
  const blocked = status === "off" || status === "paused" || status === "stale";
  const blockedLabel = status === "off" ? "Opens soon" : status === "paused" ? "Paused for a moment" : "Getting the machine ready";
  const claw = useRef<ClawHandle>(null);
  const [count, setCount] = useState(1);
  const [sealed, setSealed] = useState<number | null>(null);
  const [busy, setBusy] = useState<null | "play" | "open">(null);
  const [note, setNote] = useState<string | null>(null);
  const [ack, setAck] = useState(true);
  const [overlay, setOverlay] = useState(false);
  const [boxes, setBoxes] = useState<DrawnBox[] | null>(null);
  const [waiting, setWaiting] = useState<RevealWaiting>(null);
  const [txUrl, setTxUrl] = useState<string | undefined>();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists in the browser.
    setAck(localStorage.getItem(ACK_KEY) === "1");
  }, []);

  const refresh = useCallback(async () => {
    if (!w.address) return setSealed(null);
    try {
      const b = await readBoxes(arcClient(), w.address, [machine.id]);
      setSealed(b[machine.id] ?? 0);
    } catch {
      setSealed(null);
    }
  }, [w.address, machine.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the chain when the wallet or machine changes
    void refresh();
  }, [refresh]);

  const total = machine.priceUsdc * count;

  const onPlay = async () => {
    if (!w.address) return w.openConnect();
    if (!ack) return setNote("Confirm you are 18 or over and accept the risk disclaimer first.");
    setBusy("play");
    setNote(null);
    const show = claw.current?.run(0, GRIP_AT);
    try {
      await w.send([playCall(machine.id, count, machine.priceUsdc)]);
      await show;
      await claw.current?.run(GRIP_AT, claw.current.duration);
      void claw.current?.respawn();
      await refresh();
      setNote(count === 1 ? "A sealed box is yours. Open it whenever you like." : `${count} sealed boxes are yours. Open them whenever you like.`);
    } catch (e) {
      await show;
      claw.current?.reset();
      setNote(e instanceof Error ? e.message : "The play did not go through.");
    } finally {
      setBusy(null);
    }
  };

  /** Wait for the draw, then reveal; handles a draw that expires and a reveal someone else sent. */
  const settle = useCallback(
    async (openingId: bigint, fromBlock: bigint) => {
      const client = arcClient();
      for (;;) {
        const s = await readOpening(client, openingId);
        if (s.status === STATUS.Revealed) {
          setBoxes(await revealedBoxes(client, openingId, fromBlock));
          return;
        }
        if (s.status === STATUS.Returned) {
          setWaiting({ label: "The boxes went back to your wallet." });
          return;
        }
        if (s.status === STATUS.Fulfilled) break;
        if (Date.now() / 1000 > s.requestedAt + VRF_EXPIRY_S + 5) {
          setWaiting({
            label: "The draw took too long. Ask again, or take your boxes back.",
            action: {
              label: "Ask again",
              onClick: () => {
                setWaiting({ label: "Asking for a new draw" });
                void (async () => {
                  try {
                    await w.send([retryCall(openingId, await vrfTopUp(client))]);
                    await settle(openingId, fromBlock);
                  } catch {
                    try {
                      await w.send([returnBoxesCall(openingId)]);
                      setWaiting({ label: "The boxes went back to your wallet." });
                      await refresh();
                    } catch (e) {
                      setWaiting({ label: revertText(e) });
                    }
                  }
                })();
              },
            },
          });
          return;
        }
        await sleep(1500);
      }
      const unseal = async () => {
        setWaiting({ label: w.kind === "embedded" ? "Unsealing your cards" : "Confirm once more in your wallet to unseal your cards" });
        try {
          const hash = await w.send([revealCall(openingId)]);
          const receipt = await client.getTransactionReceipt({ hash });
          setTxUrl(explorerTx(hash));
          setBoxes(await boxesFromLogs(client, receipt.logs));
        } catch {
          // Already revealed by someone else, or the user declined: read it back, or offer the button.
          const s = await readOpening(client, openingId);
          if (s.status === STATUS.Revealed) setBoxes(await revealedBoxes(client, openingId, fromBlock));
          else setWaiting({ label: "Your draw is in. One confirmation unseals it.", action: { label: "Unseal", onClick: () => void unseal() } });
        }
      };
      await unseal();
    },
    [w, refresh],
  );

  const onOpen = async (n: number) => {
    if (!w.address) return w.openConnect();
    setBusy("open");
    setNote(null);
    setBoxes(null);
    setTxUrl(undefined);
    setWaiting({ label: "Opening your box" });
    setOverlay(true);
    try {
      const client = arcClient();
      const hash: Hex = await w.send([openCall(machine.id, n, await readTableId(client, machine.id), await vrfTopUp(client))]);
      const receipt = await client.getTransactionReceipt({ hash });
      const o = openingFromLogs(receipt.logs);
      if (!o) throw new Error("The open went through but no draw was found.");
      setWaiting({ label: "Drawing your cards" });
      await refresh();
      await settle(o.openingId, receipt.blockNumber);
    } catch (e) {
      setOverlay(false);
      setNote(revertText(e));
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const openN = Math.min(sealed ?? 0, MAX_OPEN);
  const top = machine.tiers[machine.tiers.length - 1]!;

  return (
    <div className="wrap grid gap-8 py-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center lg:gap-12 lg:py-10">
      <div className="mx-auto w-full max-w-[560px]">
        <CabinetMorph slug={machine.slug}>
          <ClawMachine ref={claw} art={art} machine={machine.slug} sound label={`The ${machine.name} machine.`} />
        </CabinetMorph>
      </div>

      <section aria-labelledby="panel-title" className="rounded-[18px] border border-line bg-panel p-6 md:p-8">
        <div className="flex items-baseline justify-between gap-4">
          <h1 id="panel-title" className="text-[clamp(36px,3.6vw,52px)] leading-none tracking-[-0.03em]">
            {machine.name}
          </h1>
          <p className="money text-[22px]">
            {machine.priceUsdc} <span className="text-muted">USDC</span>
          </p>
        </div>
        <p className="mt-3 text-[15px] text-muted">
          Expected return <span className="money text-cream">{fmtPct(machine.rtp)}</span>, at least <span className="money text-cream">{usdc(machine.priceUsdc * machine.floor)}</span>, up to{" "}
          <span className="money text-cream">{usdc(top.valueUsdc)}</span> ({fmtMultiplier(top.multiplier)}).{" "}
          <Link className="underline underline-offset-4 hover:text-cream" href="/#odds">
            Odds
          </Link>
        </p>

        <div className="mt-6 flex items-center justify-between gap-4 border-t border-line pt-6">
          <label htmlFor="boxes" className="text-[15px] text-cream">
            Boxes
          </label>
          <div className="flex items-center rounded-[10px] border border-line-strong bg-panel-2">
            <button type="button" aria-label="One box fewer" className="size-11 rounded-l-[10px] text-[20px] hover:bg-panel disabled:opacity-40" disabled={count <= 1 || !!busy} onClick={() => setCount((c) => Math.max(1, c - 1))}>
              -
            </button>
            <input
              id="boxes"
              inputMode="numeric"
              value={count}
              disabled={!!busy}
              onChange={(e) => setCount(Math.min(MAX_OPEN, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)))}
              className="money h-11 w-12 bg-transparent text-center text-[18px] outline-none"
            />
            <button type="button" aria-label="One box more" className="size-11 rounded-r-[10px] text-[20px] hover:bg-panel disabled:opacity-40" disabled={count >= MAX_OPEN || !!busy} onClick={() => setCount((c) => Math.min(MAX_OPEN, c + 1))}>
              +
            </button>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[15px] text-muted">Total</span>
          <span className="money text-[22px]">{usdc(total)} USDC</span>
        </div>

        {!ack ? (
          <label className="mt-5 flex items-start gap-3 text-[14px] leading-relaxed text-muted">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-[var(--color-cream)]"
              onChange={(e) => {
                if (!e.target.checked) return;
                localStorage.setItem(ACK_KEY, "1");
                setAck(true);
                setNote(null);
              }}
            />
            <span>
              By playing you confirm you are 18 or over and accept the{" "}
              <a className="text-cream underline underline-offset-4" href="/disclaimer" target="_blank">
                risk disclaimer
              </a>
              .
            </span>
          </label>
        ) : null}

        <button type="button" className="btn mt-5 w-full" disabled={!!busy || blocked || (!!w.address && !ack)} onClick={() => void onPlay()}>
          {blocked ? blockedLabel : !w.address ? "Connect to play" : busy === "play" ? "Playing" : <>Play for <span className="money">{usdc(total)} USDC</span></>}
        </button>

        <div className="mt-6 flex items-center justify-between gap-4 border-t border-line pt-6">
          <div>
            <p className="text-[15px] text-cream">Sealed boxes</p>
            <p className="money mt-1 text-[22px]">{sealed ?? "0"}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-cream" disabled={!openN || !!busy || status === "stale" || status === "paused"} onClick={() => void onOpen(1)}>
              Open one
            </button>
            {openN > 1 ? (
              <button type="button" className="btn-ghost" disabled={!!busy || status === "stale" || status === "paused"} onClick={() => void onOpen(openN)}>
                Open {openN}
              </button>
            ) : null}
          </div>
        </div>
        <Link href={`/app/gifts?machine=${machine.slug}`} className="mt-4 inline-block text-[14px] text-muted underline-offset-4 hover:text-cream hover:underline">
          Gift a box instead
        </Link>

        <p role="status" className={cn("mt-4 min-h-[1.5em] text-[14px]", note ? "text-cream" : "text-muted")}>
          {note}
        </p>
      </section>

      <RevealOverlay
        open={overlay}
        machine={machine}
        boxes={boxes}
        waiting={waiting}
        explorerUrl={txUrl}
        onClose={() => setOverlay(false)}
        onAnother={(sealed ?? 0) > 0 ? () => void onOpen(1) : undefined}
      />
    </div>
  );
}
