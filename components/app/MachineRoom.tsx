"use client";

/**
 * Inside a machine: the cabinet, big, and its control panel.
 *
 *   Play     pays boxes * price in Circle USDC on Solana: that many sealed boxes are yours.
 *   Grab     one wallet signature turns a sealed box into a round on the MagicBlock ephemeral rollup. The joystick then
 *            drives the claw live: every move is a rollup transaction signed by a session key in this tab, so there is
 *            no prompt and no fee, and the claw on screen follows the round's state on chain.
 *   Drop     the claw drops, MagicBlock VRF draws the pack on the rollup, the round is committed back to Solana, and a
 *            second signature pays the three stock cards. The full-screen reveal plays.
 *
 * A round left half way (a closed tab) is found on the next visit and can be finished from here. The first play asks
 * for the 18+ and risk acknowledgement, kept in localStorage.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { ClawMachine, type ClawHandle } from "@/components/claw/ClawMachine";
import type { ClawArt } from "@/components/claw/geometry";
import { useWallet } from "@/components/wallet/WalletProvider";
import { RevealOverlay, type RevealWaiting } from "./RevealOverlay";
import { CabinetMorph } from "@/components/motion/PageTransitions";
import { explorerTx } from "@/lib/solana/config";
import { erConnection, errorText, readBoxes, type DrawnBox } from "@/lib/solana/client";
import { decodeRound, playIx } from "@/lib/solana/program";
import { ClawDriver, dropAndDraw, finishRound, pendingRound, settle, startRound, voidOnBase, waitOnRollup, type RoundHandle } from "@/lib/solana/round";
import { fmtMultiplier, fmtPct, type Machine } from "@/lib/machines";
import { useMachineStatus } from "./useMachineStatus";
import { usdc } from "@/lib/stocks";
import { cn } from "@/lib/cn";

const ACK_KEY = "arclaw:ack-18";
const MAX_BOXES = 20;
const GRIP_AT = 3.4;
/** Claw travel on chain is -1000..1000 per axis; joystick speed in chain units per second at full lean. */
const RANGE = 1000;
const SPEED = 900;

type Phase = "idle" | "starting" | "aiming" | "drawing" | "returning" | "settling";

/** Chain claw position to a gantry offset from home, inside the cabinet (components/claw/view.ts). */
const toWorld = (x: number, z: number) => ({ x: ((x + RANGE) / (2 * RANGE)) * 70 - 10, y: -((z + RANGE) / (2 * RANGE)) * 70 + 4 });

export function MachineRoom({ art, machine }: { art: ClawArt; machine: Machine }) {
  const w = useWallet();
  const status = useMachineStatus(machine.id);
  const blocked = status === "off" || status === "paused" || status === "stale";
  const blockedLabel = status === "off" ? "Opens soon" : status === "paused" ? "Paused for a moment" : "Getting the machine ready";
  const claw = useRef<ClawHandle>(null);
  const [count, setCount] = useState(1);
  const [sealed, setSealed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState<string | null>(null);
  const [ack, setAck] = useState(true);
  const [overlay, setOverlay] = useState(false);
  const [boxes, setBoxes] = useState<DrawnBox[] | null>(null);
  const [waiting, setWaiting] = useState<RevealWaiting>(null);
  const [txUrl, setTxUrl] = useState<string | undefined>();
  const [pending, setPending] = useState<Awaited<ReturnType<typeof pendingRound>>>(null);
  const [chainPos, setChainPos] = useState<{ x: number; z: number; moves: number } | null>(null);

  const handle = useRef<RoundHandle | null>(null);
  const driver = useRef<ClawDriver | null>(null);
  const pos = useRef({ x: 0, z: 0 });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists in the browser.
    setAck(localStorage.getItem(ACK_KEY) === "1");
  }, []);

  const refresh = useCallback(async () => {
    if (!w.publicKey) return setSealed(null);
    try {
      setSealed((await readBoxes(w.publicKey))[machine.id] ?? 0);
      const p = await pendingRound(w.publicKey);
      setPending(p && p.machineId === machine.id ? p : null);
    } catch {
      setSealed(null);
    }
  }, [w.publicKey, machine.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the chain when the wallet or machine changes
    void refresh();
  }, [refresh]);

  /* ---------- the live claw: optimistic locally, mirrored from the rollup ---------- */

  const aimAt = (x: number, z: number) => {
    const p = toWorld(x, z);
    claw.current?.aim(p.x, p.y);
  };

  useEffect(() => {
    if (phase !== "aiming" || !handle.current) return;
    const conn = erConnection();
    const id = conn.onAccountChange(
      handle.current.round,
      (info) => {
        try {
          const r = decodeRound(info.data);
          setChainPos({ x: r.clawX, z: r.clawZ, moves: r.moves });
        } catch {
          // not a round (yet)
        }
      },
      { commitment: "processed" },
    );
    return () => void conn.removeAccountChangeListener(id);
  }, [phase]);

  const stick = useRef({ x: 0, z: 0, raf: 0, last: 0 });
  const steer = useCallback((vx: number, vz: number) => {
    const s = stick.current;
    s.x = vx;
    s.z = vz;
    if (s.raf || (vx === 0 && vz === 0)) return;
    const loop = (now: number) => {
      const dt = s.last ? Math.min(0.05, (now - s.last) / 1000) : 1 / 60;
      s.last = now;
      if (s.x === 0 && s.z === 0) {
        s.raf = 0;
        s.last = 0;
        return;
      }
      const dx = s.x * SPEED * dt;
      const dz = s.z * SPEED * dt;
      const p = pos.current;
      const nx = Math.max(-RANGE, Math.min(RANGE, p.x + dx));
      const nz = Math.max(-RANGE, Math.min(RANGE, p.z + dz));
      driver.current?.push(nx - p.x, nz - p.z);
      pos.current = { x: nx, z: nz };
      aimAt(nx, nz);
      s.raf = requestAnimationFrame(loop);
    };
    s.raf = requestAnimationFrame(loop);
  }, []);

  // Arrow keys and WASD while aiming.
  useEffect(() => {
    if (phase !== "aiming") return;
    const held = new Set<string>();
    const apply = () => steer((held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0), (held.has("up") ? 1 : 0) - (held.has("down") ? 1 : 0));
    const dir = (k: string) => ({ ArrowLeft: "left", a: "left", ArrowRight: "right", d: "right", ArrowUp: "up", w: "up", ArrowDown: "down", s: "down" })[k];
    const down = (e: KeyboardEvent) => {
      const d = dir(e.key);
      if (!d) return;
      e.preventDefault();
      held.add(d);
      apply();
    };
    const up = (e: KeyboardEvent) => {
      const d = dir(e.key);
      if (!d) return;
      held.delete(d);
      apply();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      steer(0, 0);
    };
  }, [phase, steer]);

  /* ---------- buying boxes ---------- */

  const onPlay = async () => {
    if (!w.sender) return w.openConnect();
    if (!ack) return setNote("Confirm you are 18 or over and accept the risk disclaimer first.");
    setBusy(true);
    setNote(null);
    try {
      await w.sender.send(new Transaction().add(playIx(w.sender.publicKey, machine.id, count)));
      await refresh();
      setNote(count === 1 ? "A sealed box is yours. Grab it with the claw whenever you like." : `${count} sealed boxes are yours. Grab them one by one.`);
    } catch (e) {
      setNote(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  /* ---------- a round ---------- */

  const beginAiming = async (h: RoundHandle, at?: { x: number; z: number }) => {
    handle.current = h;
    const r = await waitOnRollup(h);
    pos.current = at ?? { x: r.clawX, z: r.clawZ };
    setChainPos({ x: r.clawX, z: r.clawZ, moves: r.moves });
    aimAt(pos.current.x, pos.current.z);
    driver.current = new ClawDriver(h);
    driver.current.start();
    setPhase("aiming");
  };

  const onGrab = async () => {
    if (!w.sender) return w.openConnect();
    if (!ack) return setNote("Confirm you are 18 or over and accept the risk disclaimer first.");
    setNote(null);
    setPhase("starting");
    try {
      const h = await startRound(w.sender, machine.id);
      void refresh();
      await beginAiming(h);
    } catch (e) {
      setPhase("idle");
      setNote(errorText(e));
      void refresh();
    }
  };

  /** Everything after the claw drops: draw, commit back, pay. */
  const complete = async (h: RoundHandle, skipDraw = false) => {
    const sender = w.sender;
    if (!sender) return;
    let show: Promise<void> | undefined;
    try {
      if (!skipDraw) {
        setPhase("drawing");
        driver.current?.stop();
        claw.current?.aim(0, 0);
        await new Promise((r) => setTimeout(r, 450));
        show = claw.current?.run(0, GRIP_AT);
        const drawn = await dropAndDraw(h);
        if (drawn?.status === "requested") setNote("The draw is slow today. If it does not land, the round is voided and your box comes back.");
      }
      setPhase("returning");
      const back = await finishRound(h, sender);
      await show;
      if (back.status === "drawn") await claw.current?.run(GRIP_AT, claw.current.duration);
      else claw.current?.reset();
      void claw.current?.respawn();
      await doSettle(h, back);
    } catch (e) {
      await show;
      claw.current?.reset();
      setPhase("idle");
      setNote(errorText(e));
      void refresh();
    }
  };

  const doSettle = async (h: RoundHandle, round: Parameters<typeof settle>[1]) => {
    const sender = w.sender;
    if (!sender) return;
    setPhase("settling");
    if (round.status === "drawn") {
      setBoxes(null);
      setTxUrl(undefined);
      setWaiting({ label: "Confirm once more in your wallet to unseal your cards" });
      setOverlay(true);
    }
    const run = async () => {
      try {
        const { signature, box } = await settle(h, round, sender);
        setTxUrl(explorerTx(signature));
        if (box) setBoxes([box]);
        else setNote("The round was void, so your box is back with your sealed boxes.");
      } catch (e) {
        if (round.status === "drawn") setWaiting({ label: errorText(e), action: { label: "Unseal", onClick: () => void run() } });
        else setNote(errorText(e));
      } finally {
        setPhase("idle");
        handle.current = null;
        driver.current = null;
        void refresh();
      }
    };
    await run();
  };

  const onDrop = () => {
    const h = handle.current;
    if (h) void complete(h);
  };

  /** Picks a half-finished round back up wherever it stopped. */
  const onResume = async () => {
    const p = pending;
    const sender = w.sender;
    if (!p || !sender) return;
    setPending(null);
    setNote(null);
    try {
      if (!p.delegated) {
        if (p.state && (p.state.status === "drawn" || p.state.status === "void")) return void (await doSettle(p, p.state));
        setPhase("returning");
        await voidOnBase(p, sender);
        const again = await pendingRound(sender.publicKey);
        if (again?.state) return void (await doSettle(p, again.state));
        return setPhase("idle");
      }
      if (p.state?.status === "armed" && p.driver) return void (await beginAiming(p, { x: p.state.clawX, z: p.state.clawZ }));
      if (p.state?.status === "requested" && p.driver) {
        setPhase("drawing");
        handle.current = p;
      }
      await complete(p, true);
    } catch (e) {
      setPhase("idle");
      setNote(errorText(e));
      void refresh();
    }
  };

  const top = machine.tiers[machine.tiers.length - 1]!;
  const total = machine.priceUsdc * count;
  const inRound = phase !== "idle";

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

        {inRound ? (
          <RoundPanel phase={phase} chainPos={chainPos} onSteer={steer} onDrop={onDrop} />
        ) : (
          <>
            <div className="mt-6 flex items-center justify-between gap-4 border-t border-line pt-6">
              <label htmlFor="boxes" className="text-[15px] text-cream">
                Boxes
              </label>
              <div className="flex items-center rounded-[10px] border border-line-strong bg-panel-2">
                <button type="button" aria-label="One box fewer" className="size-11 rounded-l-[10px] text-[20px] hover:bg-panel disabled:opacity-40" disabled={count <= 1 || busy} onClick={() => setCount((c) => Math.max(1, c - 1))}>
                  -
                </button>
                <input
                  id="boxes"
                  inputMode="numeric"
                  value={count}
                  disabled={busy}
                  onChange={(e) => setCount(Math.min(MAX_BOXES, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)))}
                  className="money h-11 w-12 bg-transparent text-center text-[18px] outline-none"
                />
                <button type="button" aria-label="One box more" className="size-11 rounded-r-[10px] text-[20px] hover:bg-panel disabled:opacity-40" disabled={count >= MAX_BOXES || busy} onClick={() => setCount((c) => Math.min(MAX_BOXES, c + 1))}>
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

            <button type="button" className="btn mt-5 w-full" disabled={busy || blocked || (!!w.address && !ack)} onClick={() => void onPlay()}>
              {blocked ? blockedLabel : !w.address ? "Connect to play" : busy ? "Paying" : <>Buy for <span className="money">{usdc(total)} USDC</span></>}
            </button>

            <div className="mt-6 flex items-center justify-between gap-4 border-t border-line pt-6">
              <div>
                <p className="text-[15px] text-cream">Sealed boxes</p>
                <p className="money mt-1 text-[22px]">{sealed ?? "0"}</p>
              </div>
              <button type="button" className="btn-cream" disabled={!sealed || busy || status === "stale" || status === "paused"} onClick={() => void onGrab()}>
                Grab one with the claw
              </button>
            </div>
            {pending ? (
              <div className="mt-4 flex items-center justify-between gap-4 rounded-[12px] border border-line bg-panel-2 p-4">
                <p className="text-[14px] text-cream">You have a round in progress on this machine.</p>
                <button type="button" className="btn-ghost shrink-0" onClick={() => void onResume()}>
                  Finish it
                </button>
              </div>
            ) : null}
            <Link href={`/app/gifts?machine=${machine.slug}`} className="mt-4 inline-block text-[14px] text-muted underline-offset-4 hover:text-cream hover:underline">
              Gift a box instead
            </Link>
          </>
        )}

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
        onAnother={(sealed ?? 0) > 0 ? () => {
          setOverlay(false);
          void onGrab();
        } : undefined}
      />
    </div>
  );
}

const PHASE_LABEL: Record<Phase, string> = {
  idle: "",
  starting: "Confirm in your wallet to start the round",
  aiming: "Steer the claw, then drop it",
  drawing: "Drawing your pack with MagicBlock VRF",
  returning: "Sending the round back to Solana",
  settling: "Paying your cards",
};

/** The round's controls: a drag pad (touch and mouse), the drop button, and the claw's position on the rollup. */
function RoundPanel({ phase, chainPos, onSteer, onDrop }: { phase: Phase; chainPos: { x: number; z: number; moves: number } | null; onSteer: (x: number, z: number) => void; onDrop: () => void }) {
  const pad = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const aiming = phase === "aiming";

  const move = (e: React.PointerEvent) => {
    const r = pad.current?.getBoundingClientRect();
    if (!r) return;
    let x = ((e.clientX - r.left) / r.width) * 2 - 1;
    let y = ((e.clientY - r.top) / r.height) * 2 - 1;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    setKnob({ x, y });
    onSteer(x, -y);
  };
  const release = () => {
    setKnob({ x: 0, y: 0 });
    onSteer(0, 0);
  };

  return (
    <div className="mt-6 border-t border-line pt-6">
      <p className="text-[15px] text-cream">{PHASE_LABEL[phase]}</p>
      {aiming ? (
        <>
          <div className="mt-5 flex items-center gap-6">
            <div
              ref={pad}
              role="application"
              aria-label="Joystick: drag to steer the claw, or use the arrow keys"
              className="relative size-36 shrink-0 touch-none rounded-full border border-line-strong bg-panel-2"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                move(e);
              }}
              onPointerMove={(e) => {
                if (e.buttons) move(e);
              }}
              onPointerUp={release}
              onPointerCancel={release}
            >
              <span
                className="absolute left-1/2 top-1/2 size-14 rounded-full border border-line-strong bg-cream"
                style={{ transform: `translate(calc(-50% + ${knob.x * 44}px), calc(-50% + ${knob.y * 44}px))` }}
              />
            </div>
            <button type="button" className="btn flex-1" onClick={onDrop}>
              Drop the claw
            </button>
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-2 text-[13px]">
            <div>
              <dt className="text-muted">Claw on chain</dt>
              <dd className="money text-cream">{chainPos ? `${chainPos.x}, ${chainPos.z}` : "..."}</dd>
            </div>
            <div>
              <dt className="text-muted">Moves</dt>
              <dd className="money text-cream">{chainPos?.moves ?? 0}</dd>
            </div>
            <div>
              <dt className="text-muted">Running on</dt>
              <dd className="text-cream">MagicBlock ER</dd>
            </div>
          </dl>
          <p className="mt-4 text-[13px] leading-relaxed text-muted">Every move is a transaction on the ephemeral rollup, signed in this tab: no wallet prompt and no fee. Where you drop does not change the odds: the VRF picks the pack.</p>
        </>
      ) : null}
    </div>
  );
}
