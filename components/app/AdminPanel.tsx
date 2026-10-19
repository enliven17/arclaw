"use client";

/**
 * The admin panel: treasury, usage, machines, inventory, players and the keeper's log, from POST /api/admin. The
 * admin wallet signs a 15-minute read-only sign-in (lib/admin.ts); it is kept for this tab only and the panel refreshes
 * every 30 seconds until it lapses. Any other wallet sees nothing: the server answers it with a 404.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSignMessage } from "wagmi";
import { useWallet } from "@/components/wallet/WalletProvider";
import { ADMIN, adminMessage } from "@/lib/admin";
import { explorerAddress, explorerTx } from "@/lib/arc/config";
import { machineById } from "@/lib/machines";
import { usdc } from "@/lib/stocks";
import { cn } from "@/lib/cn";

type Part<T> = { ok: true; data: T } | { ok: false; error: string };
type MachineTotals = { plays: number; boxes: number; inUsdc: number; packs: number; outUsdc: number };
type Stats = {
  players: number;
  plays: number;
  boxes: number;
  packs: number;
  inUsdc: number;
  outUsdc: number;
  machines: Record<string, MachineTotals>;
  tiers: Record<string, number>;
  topPlayers: { player: string; spentUsdc: number; totalUsdc: number; packs: number; best: number }[];
  recentPlays: { id: string; player: string; machineId: number; boxes: number; paidUsdc: number; blockNumber: number }[];
  recentPulls: { id: string; player: string; machineId: number; tierName: string; valueUsdc: number; blockNumber: number; txHash: string }[];
  indexedBlock: number;
};
type Keeper = {
  lastTick: { at: number; ok: boolean; summary: string } | null;
  health: { at: number; ok: boolean; issues: { key: string; severity: string; message: string }[]; metrics: Record<string, string | number | boolean | null> } | null;
  failures: number;
  paused: boolean;
  machines: { id: number; fresh: boolean; openable: boolean; staleAt: number | null; waking: boolean }[];
  events: { at: number; kind: string; level: string; message: string; tx: string | null }[];
};
type Chain = { network: string; arclaw: string; block: string; paused: boolean; usdc: string; inventory: { ticker: string; shares: string }[] };
type Data = { at: number; stats: Part<Stats>; keeper: Part<Keeper>; chain: Part<Chain> };
type Session = { message: string; signature: string; expires: number };

const KEY = "arclaw:admin";
const REFRESH_MS = 30_000;
const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
// RPC errors carry whole request bodies; the first line is the useful part.
const clip = (s: string) => (s.length > 160 ? `${s.slice(0, 160)}...` : s);
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
// Keeper times are chain seconds; anything bigger is already ms.
const when = (t: number) => new Date(t < 1e12 ? t * 1000 : t).toLocaleString("en-GB", { hour12: false });

const readSession = (): Session | null => {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Session | null;
    return s && s.expires > Date.now() ? s : null;
  } catch {
    return null;
  }
};

export function AdminPanel() {
  const w = useWallet();
  const { signMessageAsync } = useSignMessage();
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = w.address === ADMIN;

  // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is only readable after mount
  useEffect(() => setSession(readSession()), []);

  const load = useCallback(async (s: Session) => {
    const res = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
    if (!res.ok) {
      setError(res.status === 404 ? "The server did not accept this sign-in. Sign in again." : `The panel could not load (${res.status}).`);
      setSession(null);
      sessionStorage.removeItem(KEY);
      return;
    }
    setError(null);
    setData((await res.json()) as Data);
  }, []);

  useEffect(() => {
    if (!session || !isAdmin) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load sets state after its fetch, not synchronously
    void load(session);
    const t = setInterval(() => (session.expires > Date.now() ? void load(session) : setSession(null)), REFRESH_MS);
    return () => clearInterval(t);
  }, [session, isAdmin, load]);

  const signIn = async () => {
    try {
      const expires = Date.now() + 15 * 60_000;
      const message = adminMessage(window.location.host, expires);
      const s = { message, signature: await signMessageAsync({ message }), expires };
      try {
        sessionStorage.setItem(KEY, JSON.stringify(s));
      } catch {
        // Private mode: the sign-in lasts for this page only.
      }
      setSession(s);
    } catch {
      setError("The signature was declined.");
    }
  };

  if (!w.address || !isAdmin || !session) {
    return (
      <div className="wrap py-16">
        <h1 className="h-section !text-[clamp(40px,5vw,72px)]">Admin.</h1>
        <p className="mt-4 max-w-[52ch] text-[16px] text-muted">
          {!w.address ? "Connect the admin wallet to continue." : !isAdmin ? "This wallet has no access." : "Sign a read-only message to open the panel for 15 minutes. It moves no funds."}
        </p>
        {error ? <p className="mt-3 text-[15px] text-claw">{error}</p> : null}
        <div className="mt-6">
          {!w.address ? (
            <button type="button" className="btn-cream" onClick={w.openConnect}>
              Connect
            </button>
          ) : isAdmin ? (
            <button type="button" className="btn-cream" onClick={() => void signIn()}>
              Sign in
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="wrap grid gap-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="h-section !text-[clamp(40px,5vw,72px)]">Admin.</h1>
        <div className="flex items-center gap-3 text-[14px] text-muted">
          {data ? <span>Updated {new Date(data.at).toLocaleTimeString("en-GB", { hour12: false })}</span> : <span>Loading</span>}
          <button type="button" className="btn-ghost !min-h-[36px] !px-3 !py-2 text-[14px]" onClick={() => void load(session)}>
            Refresh
          </button>
        </div>
      </div>
      {error ? <p className="text-[15px] text-claw">{error}</p> : null}
      {data ? <Body data={data} /> : null}
    </div>
  );
}

function Body({ data }: { data: Data }) {
  const { stats, keeper, chain } = data;
  const m = keeper.ok ? (keeper.data.health?.metrics ?? {}) : {};
  const s = stats.ok ? stats.data : null;
  return (
    <>
      <Card title="Treasury">
        {chain.ok ? (
          <Grid>
            <Stat label="Contract USDC (live)" value={usdc(Number(chain.data.usdc))} />
            <Stat label="Paused" value={chain.data.paused ? "Yes" : "No"} alert={chain.data.paused} />
            <Stat label="Network" value={`${chain.data.network}, block ${chain.data.block}`} />
            <Stat label="Contract" value={<a className="underline underline-offset-4" href={explorerAddress(chain.data.arclaw)} target="_blank" rel="noopener noreferrer">{short(chain.data.arclaw)}</a>} />
          </Grid>
        ) : (
          <Err text={chain.error} />
        )}
        {keeper.ok && keeper.data.health ? (
          <>
            <p className="mb-4 mt-8 text-[13px] text-muted">From the keeper&apos;s last health check, {when(keeper.data.health.at)}</p>
            <Grid>
              {(
                [
                  ["Balance", "balanceUsdc"],
                  ["Unreserved", "unreservedUsdc"],
                  ["Free", "freeUsdc"],
                  ["Owed to players", "totalOwedUsdc"],
                  ["Pending reserve", "pendingUsdc"],
                  ["Sealed reserve", "sealedUsdc"],
                  ["Reserve floor", "reserveFloorUsdc"],
                  ["Min buffer", "minBufferUsdc"],
                  ["Top-up reserve", "topUpReserveUsdc"],
                  ["Keeper gas wallet", "keeperGasUsdc"],
                  ["Just-in-time buys today", "jitSpentTodayUsdc"],
                  ["Just-in-time cap", "jitCapUsdc"],
                  ["Keeper gas today", "gasSpentTodayUsdc"],
                ] as const
              ).map(([label, k]) => (
                <Stat key={k} label={label} value={m[k] == null ? "n/a" : usdc(Number(m[k]))} />
              ))}
              <Stat label="Openings in flight" value={String(m.openOpenings ?? "n/a")} />
              <Stat label="VRF misses today" value={String(m.vrfMissesToday ?? "n/a")} />
            </Grid>
          </>
        ) : null}
      </Card>

      <Card title="Usage">
        {s ? (
          <Grid>
            <Stat label="Players" value={String(s.players)} />
            <Stat label="Plays" value={String(s.plays)} />
            <Stat label="Boxes bought" value={String(s.boxes)} />
            <Stat label="Packs opened" value={String(s.packs)} />
            <Stat label="Sealed, not opened" value={String(s.boxes - s.packs)} />
            <Stat label="USDC in" value={usdc(s.inUsdc)} />
            <Stat label="Paid out in cards" value={usdc(s.outUsdc)} />
            <Stat label="House net" value={usdc(s.inUsdc - s.outUsdc)} alert={s.inUsdc - s.outUsdc < 0} />
            <Stat label="Realised return" value={pct(s.outUsdc, s.inUsdc)} />
          </Grid>
        ) : (
          <Err text={stats.ok ? "" : stats.error} />
        )}
        {s ? <p className="mt-4 text-[13px] text-muted">Indexed to block {s.indexedBlock}. Paid out counts opened packs only; sealed boxes are still owed.</p> : null}
      </Card>

      {s ? (
        <Card title="Machines">
          <Table
            head={["Machine", "Plays", "Boxes", "In", "Packs", "Out", "Return", "Table"]}
            rows={Object.entries(s.machines).map(([id, x]) => {
              const k = keeper.ok ? keeper.data.machines.find((y) => y.id === Number(id)) : undefined;
              return [machineById(Number(id)).name, x.plays, x.boxes, usdc(x.inUsdc), x.packs, usdc(x.outUsdc), pct(x.outUsdc, x.inUsdc), k ? (k.fresh ? "Fresh" : k.waking ? "Waking" : "Stale") : "n/a"];
            })}
          />
          <p className="mt-4 text-[14px] text-muted">
            {Object.entries(s.tiers)
              .sort((a, b) => b[1] - a[1])
              .map(([t, n]) => `${t} ${n}`)
              .join("   ")}
          </p>
        </Card>
      ) : null}

      {chain.ok ? (
        <Card title="Stock inventory">
          {chain.data.inventory.length ? <Table head={["Stock", "Shares held"]} rows={chain.data.inventory.map((x) => [x.ticker, Number(x.shares).toLocaleString("en-US", { maximumFractionDigits: 6 })])} /> : <p className="text-[15px] text-muted">The contract holds no stock right now.</p>}
        </Card>
      ) : null}

      {keeper.ok ? (
        <Card title="Keeper">
          <Grid>
            <Stat label="Health" value={keeper.data.health ? (keeper.data.health.ok ? "OK" : "Critical") : "n/a"} alert={keeper.data.health?.ok === false} />
            <Stat label="Last tick" value={keeper.data.lastTick ? `${when(keeper.data.lastTick.at)} ${keeper.data.lastTick.ok ? "" : "(failed)"}` : "never"} />
            <Stat label="Failures in a row" value={String(keeper.data.failures)} alert={keeper.data.failures > 0} />
          </Grid>
          {keeper.data.health?.issues.length ? (
            <ul className="mt-5 grid gap-2">
              {keeper.data.health.issues.map((i) => (
                <li key={i.key} className={cn("text-[14px]", i.severity === "critical" ? "text-claw" : "text-muted")}>
                  <span className="money mr-2">{i.severity}</span>
                  {i.message}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-6">
            <Table
              head={["Time", "Kind", "Message"]}
              rows={keeper.data.events.map((e) => [when(e.at), e.kind, e.tx ? <a key="tx" className="underline underline-offset-4" href={explorerTx(e.tx)} target="_blank" rel="noopener noreferrer">{clip(e.message)}</a> : clip(e.message)])}
            />
          </div>
        </Card>
      ) : (
        <Card title="Keeper">
          <Err text={keeper.error} />
        </Card>
      )}

      {s ? (
        <>
          <Card title="Top players">
            <Table head={["Player", "Spent", "Pulled", "Packs", "Best"]} rows={s.topPlayers.map((p) => [<Addr key="a" a={p.player} />, usdc(p.spentUsdc), usdc(p.totalUsdc), p.packs, usdc(p.best)])} />
          </Card>
          <Card title="Latest plays">
            <Table head={["Block", "Player", "Machine", "Boxes", "Paid"]} rows={s.recentPlays.map((p) => [p.blockNumber, <Addr key="a" a={p.player} />, machineById(p.machineId).name, p.boxes, usdc(p.paidUsdc)])} />
          </Card>
          <Card title="Latest pulls">
            <Table
              head={["Block", "Player", "Machine", "Tier", "Value"]}
              rows={s.recentPulls.map((p) => [
                <a key="b" className="underline underline-offset-4" href={explorerTx(p.txHash)} target="_blank" rel="noopener noreferrer">{p.blockNumber}</a>,
                <Addr key="a" a={p.player} />,
                machineById(p.machineId).name,
                p.tierName,
                usdc(p.valueUsdc),
              ])}
            />
          </Card>
        </>
      ) : null}
    </>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[18px] border border-line bg-panel p-5 md:p-7">
      <h2 className="mb-5 text-[22px] tracking-[-0.01em]">{title}</h2>
      {children}
    </section>
  );
}

const Grid = ({ children }: { children: ReactNode }) => <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">{children}</div>;

function Stat({ label, value, alert }: { label: string; value: ReactNode; alert?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-muted">{label}</p>
      <p className={cn("money mt-1 truncate text-[18px]", alert && "text-claw")}>{value}</p>
    </div>
  );
}

const Err = ({ text }: { text: string }) => <p className="text-[15px] text-claw">Could not read this: {text || "unknown error"}</p>;

const Addr = ({ a }: { a: string }) => (
  <a className="underline underline-offset-4" href={explorerAddress(a)} target="_blank" rel="noopener noreferrer">
    {short(a)}
  </a>
);

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <p className="text-[15px] text-muted">Nothing yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-[14px]">
        <thead>
          <tr className="text-muted">
            {head.map((h) => (
              <th key={h} className="border-b border-line pb-2 pr-4 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="money border-b border-line py-2 pr-4 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
