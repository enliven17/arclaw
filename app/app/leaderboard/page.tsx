/**
 * Leaderboard: top players by the value they have pulled, the biggest single packs, and the biggest per machine.
 * Fed by the Convex indexer (or the chain directly until it is configured); refreshed every minute.
 */
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { getLeaderboard } from "@/lib/leaderboard.server";
import { MACHINES } from "@/lib/machines";
import { usdc } from "@/lib/stocks";
import { explorerTx } from "@/lib/solana/config";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "See the biggest arclaw pulls and the players who have opened the most tokenized stock packs on Solana.",
  alternates: { canonical: "/app/leaderboard" },
};
export const revalidate = 60;

const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const BIG = new Set(["Legendary", "Jackpot"]);

export default async function LeaderboardPage() {
  const data = await getLeaderboard();
  const board = data?.board;
  return (
    <div className="wrap py-10 md:py-14">
      <Breadcrumbs className="mb-8" items={[{ label: "Home", href: "/" }, { label: "Leaderboard", href: "/app/leaderboard" }]} />
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <h1 className="h-section !text-[clamp(40px,5vw,80px)]">Leaderboard.</h1>
        <p className="lede max-w-[26em]">Who has pulled the most, and the biggest packs so far. Updated every minute.</p>
      </div>

      {!board ? (
        <p className="mt-10 text-[16px] text-muted">The leaderboard is not available right now.</p>
      ) : (
        <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <section aria-labelledby="top-players" className="rounded-[18px] border border-line bg-panel">
            <h2 id="top-players" className="border-b border-line px-5 py-4 text-[18px] md:px-6">
              Top players
            </h2>
            {board.players.length === 0 ? (
              <p className="px-5 py-6 text-[15px] text-muted md:px-6">No packs opened yet. Be the first.</p>
            ) : (
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Players by total value pulled</caption>
                <thead>
                  <tr className="border-b border-line text-[13px] text-muted">
                    <th scope="col" className="w-12 px-5 py-3 font-normal md:px-6">
                      #
                    </th>
                    <th scope="col" className="px-2 py-3 font-normal">
                      Player
                    </th>
                    <th scope="col" className="hidden px-2 py-3 text-right font-normal sm:table-cell">
                      Packs
                    </th>
                    <th scope="col" className="hidden px-2 py-3 text-right font-normal sm:table-cell">
                      Best
                    </th>
                    <th scope="col" className="px-5 py-3 text-right font-normal md:px-6">
                      Pulled
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {board.players.map((p, i) => (
                    <tr key={p.player} className="border-b border-line last:border-b-0">
                      <td className="money px-5 py-3 text-[15px] text-muted md:px-6">{i + 1}</td>
                      <td className="money px-2 py-3 text-[15px]">{short(p.player)}</td>
                      <td className="money hidden px-2 py-3 text-right text-[15px] text-muted sm:table-cell">{p.packs}</td>
                      <td className="money hidden px-2 py-3 text-right text-[15px] text-muted sm:table-cell">{usdc(p.best)}</td>
                      <td className="money px-5 py-3 text-right text-[16px] md:px-6">{usdc(p.totalUsdc)} USDC</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className="grid content-start gap-4">
            <section aria-labelledby="biggest" className="rounded-[18px] border border-line bg-panel">
              <h2 id="biggest" className="border-b border-line px-5 py-4 text-[18px]">
                Biggest pulls
              </h2>
              <ul>
                {board.biggest.slice(0, 8).map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 last:border-b-0">
                    <span className="min-w-0">
                      <span className={cn("block text-[15px]", BIG.has(x.tierName) ? "text-prize" : "text-cream")}>
                        {x.tierName} <span className="text-muted">{MACHINES.find((m) => m.id === x.machineId)?.name}</span>
                      </span>
                      <span className="money block text-[13px] text-muted">{short(x.player)}</span>
                    </span>
                    <a className="money shrink-0 text-[15px] hover:underline" href={explorerTx(x.signature)} target="_blank" rel="noopener noreferrer">
                      {usdc(x.valueUsdc)} USDC
                    </a>
                  </li>
                ))}
                {board.biggest.length === 0 ? <li className="px-5 py-6 text-[15px] text-muted">Nothing yet.</li> : null}
              </ul>
            </section>

            <section aria-labelledby="per-machine" className="rounded-[18px] border border-line bg-panel">
              <h2 id="per-machine" className="border-b border-line px-5 py-4 text-[18px]">
                Best per machine
              </h2>
              <dl>
                {MACHINES.map((m) => {
                  const top = board.byMachine[m.id]?.[0];
                  return (
                    <div key={m.id} className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 last:border-b-0">
                      <dt className="text-[15px]">{m.name}</dt>
                      <dd className="money text-[15px]">{top ? `${usdc(top.valueUsdc)} USDC` : <span className="text-muted">None yet</span>}</dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
