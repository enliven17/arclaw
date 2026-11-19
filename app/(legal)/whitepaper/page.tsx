import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { SOLANA, explorerAddress } from "@/lib/solana/config";
import { VRF_PROGRAM_ID, DELEGATION_PROGRAM_ID, configPda } from "@/lib/solana/program";
import { MACHINES, fmtMultiplier, fmtPct } from "@/lib/machines";
import { usdc } from "@/lib/stocks";

export const metadata: Metadata = {
  title: "Whitepaper",
  description: "How arclaw works: the claw, the odds, the randomness, the treasury and the security model.",
  alternates: { canonical: "/whitepaper" },
};

const VERSION = "2.1";
const UPDATED = "19 November 2026";

const TOC = [
  ["summary", "Summary"],
  ["play", "How a play works"],
  ["odds", "The machines and the odds"],
  ["randomness", "Randomness"],
  ["treasury", "Prizes and the treasury"],
  ["security", "Security model"],
  ["roadmap", "Roadmap"],
  ["risks", "Risks and limits"],
  ["contracts", "Contracts"],
] as const;

const th = "px-3 py-3 text-left text-[13px] font-normal text-muted";
const td = "px-3 py-3 text-[15px] text-cream";

export default function Whitepaper() {
  const c = SOLANA.deployment;
  return (
    <>
      <Breadcrumbs className="mb-10" items={[{ label: "Home", href: "/" }, { label: "Whitepaper", href: "/whitepaper" }]} />
      <h1>Whitepaper</h1>
      <p className="lede">
        Version {VERSION}, {UPDATED}. How arclaw works, what it guarantees, and what it does not.
      </p>

      <nav aria-label="Contents" className="mt-8 rounded-[14px] border border-line bg-panel p-5">
        <ol className="grid gap-x-8 gap-y-1 text-[15px] md:grid-cols-2">
          {TOC.map(([id, label], i) => (
            <li key={id} className="!mt-0 !text-[15px]">
              <a href={`#${id}`}>
                {i + 1}. {label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <h2 id="summary">1. Summary</h2>
      <p>
        The current deployment runs on Solana devnet with MagicBlock ephemeral rollups and VRF. Circle devnet USDC,
        devnet SOL and the test stock tokens have no monetary value. Test stock tokens do not represent company shares.
        Get test USDC from <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">Circle&apos;s faucet</a> and
        devnet SOL from <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">Solana&apos;s faucet</a>.
      </p>
      <p>
        arclaw is a claw machine on Solana. You pay USDC, steer a claw live, grab a sealed box, and open it into a pack of
        three cards. Every card pays a stock token straight to your wallet, using test mints on devnet and xStocks for a
        future mainnet deployment. Every play wins a box: the claw is
        theatre, and an on-chain program decides what is inside, using verifiable randomness.
      </p>
      <p>
        The claw runs on a MagicBlock ephemeral rollup, so every move of the joystick is a real transaction that confirms
        in milliseconds without a wallet prompt or a fee. The draw comes from MagicBlock VRF. When the round is over it is
        committed back to Solana, where the pack is paid.
      </p>
      <p>
        The game is designed around three promises that the program enforces, not the website: the odds are fixed in a
        published table, every box is worth at least half of its price at the values its table was set with, and the
        house always keeps a positive edge so the game can pay its prizes. This paper explains each of them, the machinery
        behind them, and the risks that remain.
      </p>

      <h2 id="play">2. How a play works</h2>
      <ol className="mt-4 list-decimal pl-5">
        <li>
          <strong>Connect.</strong> Connect any Solana wallet: Phantom, Solflare, Backpack or any Wallet Standard wallet,
          or Mobile Wallet Adapter to play from an Android phone. Boxes are paid in Circle&apos;s USDC; network fees are paid
          in SOL.
        </li>
        <li>
          <strong>Pick a machine and pay.</strong> Three machines cost 1, 5 or 10 USDC per play. A play adds one sealed box
          to your account in the program. You can hold it, send it or gift it.
        </li>
        <li>
          <strong>Start a round.</strong> One wallet signature turns a sealed box into a round and hands it to a MagicBlock
          ephemeral rollup. The round records the outcome table it started on.
        </li>
        <li>
          <strong>Steer and drop.</strong> You move the claw with a joystick. Every move is a rollup transaction signed by a
          session key that lives in your browser tab: no wallet prompt, no fee, confirmed in milliseconds. The session key
          can only move and drop the claw; it cannot touch your funds. When you drop, the round asks MagicBlock VRF for a
          random number, and the program draws a pack from the machine&apos;s table. Where the claw lands does not change
          the odds.
        </li>
        <li>
          <strong>Settle.</strong> The round is committed back to Solana, and a second wallet signature pays the three
          cards to your wallet. In the app you tear the pack and flip the cards.
        </li>
        <li>
          <strong>Keep, send or sell.</strong> The cards are tokens in your wallet. Keep them or send them. On mainnet, sell
          them for USDC through a swap on Jupiter, which the app opens for you.
        </li>
      </ol>
      <p>
        A closed tab never loses a box: a round left half way is found on your next visit and can be finished from there.
      </p>
      <p>
        Boxes can be gifted to any Solana address or through a claim link. A claim link carries a one-time key that
        co-signs the recipient&apos;s claim transaction. Anyone holding the complete link can claim its boxes, so keep it
        private until it reaches the intended recipient. The signature prevents changing the recipient of a submitted claim. If a link
        is not claimed within 7 days, the sender can take the boxes back.
      </p>

      <h2 id="odds">3. The machines and the odds</h2>
      <p>
        Each machine draws from its own fixed table of outcomes: every outcome is a pack of three cards worth a multiple of
        the price. Small outcomes are common and big ones are rare. Bigger machines pay back more on average.
      </p>
      {MACHINES.map((m) => (
        <div key={m.id} className="mt-6 overflow-hidden rounded-[14px] border border-line bg-panel">
          <p className="!mt-0 border-b border-line px-3 py-3 !text-[16px] text-cream">
            {m.name}, {m.priceUsdc} USDC per play. Expected return {fmtPct(m.rtp)}, house edge {fmtPct(1 - m.rtp)}.
          </p>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={th}>
                  Outcome
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Pays
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Value
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Chance
                </th>
              </tr>
            </thead>
            <tbody>
              {m.tiers.map((t) => (
                <tr key={t.name} className="border-b border-line last:border-b-0">
                  <th scope="row" className={`${td} text-left font-normal`}>
                    {t.name}
                  </th>
                  <td className={`${td} money text-right`}>{fmtMultiplier(t.multiplier)}</td>
                  <td className={`${td} money text-right`}>{usdc(t.valueUsdc)}</td>
                  <td className={`${td} money text-right`}>{fmtPct(t.probability, t.probability < 0.01 ? 2 : 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <p>What the program enforces on every machine, whoever operates it:</p>
      <ul>
        <li>
          <strong>A floor.</strong> No outcome is worth less than 50 percent of the price, at the USDC values recorded
          when its table was set. The program refuses any machine whose floor is set lower. The lowest outcome is built a
          little above the floor (52.65 percent).
        </li>
        <li>
          <strong>A cap.</strong> No outcome is worth more than the machine&apos;s cap. Every machine launches with a cap of
          10 times the price, and the jackpot sits at that cap.
        </li>
        <li>
          <strong>A return band.</strong> Each machine has its own narrow band for the expected return (for example 74 to 76
          percent for Single). A table outside its band is rejected, so the odds cannot quietly be made worse than
          advertised. The program never accepts a band above 95 percent, so the house edge cannot go negative.
        </li>
        <li>
          <strong>Fixed prices.</strong> A machine&apos;s price cannot change once it is set. Changing a machine&apos;s rules
          clears its table, so a new table has to pass the new rules.
        </li>
      </ul>
      <p>
        These are guarantees about the table, measured in USDC values. Because prizes are stocks, what a card is worth in
        dollars moves with the market after you receive it.
      </p>

      <h2 id="randomness">4. Randomness</h2>
      <p>
        Outcomes come from MagicBlock VRF, a verifiable random function. When you drop the claw, the round asks the VRF for
        a random number on the rollup, and the answer comes back with a proof that it was produced honestly. The program
        then makes one weighted draw from the table the round started on. Your seed and the position of the claw are mixed
        into the request so every request is distinct, but they cannot steer the result.
      </p>
      <p>
        A round can never end on an outcome it was not entitled to. If the draw does not arrive within 120 seconds, the
        round can be voided. Finish and settle the round to recover its sealed box. The same recovery path applies if you abandon a round before the drop, or if the
        machine&apos;s table was replaced while your round was waiting.
      </p>
      <p>
        The trust model is explicit: the VRF and the rollup are run by MagicBlock, and the program relies on them to
        deliver. Their guarantees are theirs; arclaw adds a timeout and a void path so a failure costs you time, not boxes.
      </p>

      <h2 id="treasury">5. Prizes and the treasury</h2>
      <ul>
        <li>
          <strong>Prizes come from a vault.</strong> The program holds the prize stocks in a vault it controls and pays each
          card from it when a round is settled. On mainnet the prizes are xStocks; on devnet they are test tokens.
        </li>
        <li>
          <strong>Your box is reserved.</strong> The price of every box that has not been settled yet is reserved in the
          treasury. Nobody can withdraw it: the admin can only withdraw USDC above the reserve and what is owed.
        </li>
        <li>
          <strong>If the vault is short</strong> for a card, that card is refunded at its table value in USDC. If the
          treasury has no free USDC at that moment, the refund is recorded as owed to you and you can claim it once the
          treasury can pay.
        </li>
        <li>
          <strong>Fresh tables.</strong> Each table records when it was set, and the program can be configured to refuse
          new rounds on a table older than a set age.
        </li>
        <li>
          <strong>Void rounds.</strong> A round that is void, for any of the reasons in the randomness section, returns its
          box to you.
        </li>
      </ul>

      <h2 id="security">6. Security model</h2>
      <p>
        Devnet uses test assets. The program still enforces payment, ownership and treasury rules on chain; mainnet
        deployment requires independent audits.
      </p>
      <ul>
        <li>
          <strong>Small rules, tested.</strong> The table rules and the weighted draw are plain functions with their own
          unit tests, separate from the rest of the program.
        </li>
        <li>
          <strong>No external audit yet.</strong> The program has not been audited by a professional firm. Mainnet waits
          for audits. Until then, treat it as new software and play accordingly.
        </li>
        <li>
          <strong>Roles.</strong> An admin key sets machines, pauses play, withdraws free USDC and moves prize stock in and out of the vault. An operator key can set
          tables, inside each machine&apos;s rules.
        </li>
        <li>
          <strong>Limits on every role.</strong> No role can touch the reserve of unsettled boxes or what is owed, make a
          table outside its band, set a floor under 50 percent, or change a machine&apos;s price.
        </li>
        <li>
          <strong>Session keys.</strong> The key in your browser can only steer and drop the claw in a round it was named
          for. It cannot spend tokens in your wallet. Paying for boxes takes your wallet&apos;s signature. Settlement can
          be submitted by anyone, but its cards and account rent always go to the player recorded in the round.
        </li>
        <li>
          <strong>On the website.</strong> A strict content policy, no framing, signed share links that only show packs read
          from the chain, a region gate and an age confirmation before the app.
        </li>
      </ul>
      <p>
        What can still go wrong: a bug nobody found, the VRF or the rollup failing or misbehaving, the stock tokens or their
        issuer failing or being paused, the Solana network, a compromised key. Prize stock in the vault is not reserved the
        way box prices are, which is why a short vault falls back to a USDC refund. The risks section lists the rest.
      </p>

      <h2 id="roadmap">7. Roadmap</h2>
      <ol className="mt-4 list-decimal pl-5">
        <li>
          <strong>Devnet, now.</strong> The full product on Solana devnet with Circle USDC from the faucet and test stocks:
          play, steer, draw, settle, gift and the leaderboard.
        </li>
        <li>
          <strong>Mainnet, later.</strong> After audits, the program goes to mainnet with xStocks as prizes and the program
          address is published here. None of this is a commitment on timing.
        </li>
      </ol>

      <h2 id="risks">8. Risks and limits</h2>
      <ul>
        <li>
          <strong>You can lose money.</strong> On average a box returns less than its price. Most boxes are worth less than
          the play price. Only play with money you can afford to lose.
        </li>
        <li>
          <strong>Stocks move.</strong> On mainnet, cards are xStocks issued by Backed. They are not shares, they can fall
          in value, and they depend on the issuer, its reserves and its custodians. A token can be paused or delisted.
        </li>
        <li>
          <strong>Program and service risk.</strong> The program, MagicBlock&apos;s rollup and VRF, wallets and the Solana
          network can fail or be attacked. Blockchain transactions cannot be reversed.
        </li>
        <li>
          <strong>Legal.</strong> A paid game of chance with prizes of value is regulated, licensed or forbidden in many
          places. The app is not offered in some regions and you must be 18 or older. You are responsible for what is lawful
          where you are and for taxes on what you win or sell. Nothing here is financial, legal or tax advice.
        </li>
        <li>
          <strong>Governance of the team.</strong> Machines, tables and pauses are set by the team within the on-chain
          rules above. The rules protect you from the worst changes, not from all of them.
        </li>
      </ul>
      <p>
        Read the <a href="/disclaimer">risk disclaimer</a> and the <a href="/privacy">privacy policy</a> before you play.
      </p>

      <h2 id="contracts">9. Contracts</h2>
      {c ? (
        <>
          <p>Deployed on Solana {SOLANA.network === "devnet" ? "devnet" : "mainnet"}.</p>
          <div className="mt-4 overflow-hidden rounded-[14px] border border-line bg-panel">
            <table className="w-full border-collapse">
              <tbody>
                {(
                  [
                    ["arclaw program", c.programId],
                    ["Treasury and vault owner", configPda().toBase58()],
                    ["USDC (Circle)", c.usdcMint],
                    ["MagicBlock VRF", VRF_PROGRAM_ID.toBase58()],
                    ["MagicBlock delegation", DELEGATION_PROGRAM_ID.toBase58()],
                  ] as const
                ).map(([name, address]) => (
                  <tr key={name} className="border-b border-line last:border-b-0">
                    <th scope="row" className={`${td} text-left font-normal text-muted`}>
                      {name}
                    </th>
                    <td className={`${td} money break-all`}>
                      <a href={explorerAddress(address)} target="_blank" rel="noreferrer">
                        {address}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p>The mainnet program address is published here at launch.</p>
      )}
      <p>
        Source and tests are in the project repository. The chain is <a href="https://solana.com">Solana</a>, the real time
        claw and the randomness run on <a href="https://www.magicblock.gg">MagicBlock</a> (ephemeral rollups and VRF), USDC is
        Circle&apos;s. Devnet prizes are test mints; future mainnet prizes are intended to use <a href="https://xstocks.com">xStocks</a>.
      </p>
    </>
  );
}
