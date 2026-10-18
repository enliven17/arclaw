import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { ARC, explorerAddress } from "@/lib/arc/config";
import { MACHINES, fmtMultiplier, fmtPct } from "@/lib/machines";
import { usdc } from "@/lib/stocks";
import { ARCLAW_SYMBOL, ARCLAW_TOKEN } from "@/lib/token";

export const metadata: Metadata = {
  title: "Whitepaper",
  description: "How arclaw works: the claw, the odds, the randomness, the treasury, the security model and the ARCLAW token.",
  alternates: { canonical: "/whitepaper" },
};

const VERSION = "1.0";
const UPDATED = "October 2026";

const TOC = [
  ["summary", "Summary"],
  ["play", "How a play works"],
  ["odds", "The machines and the odds"],
  ["randomness", "Randomness"],
  ["treasury", "Prizes and the treasury"],
  ["security", "Security model"],
  ["token", "The ARCLAW token"],
  ["roadmap", "Roadmap"],
  ["risks", "Risks and limits"],
  ["contracts", "Contracts"],
] as const;

const th = "px-3 py-3 text-left text-[13px] font-normal text-muted";
const td = "px-3 py-3 text-[15px] text-cream";

export default function Whitepaper() {
  const c = ARC.contracts;
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
        arclaw is a claw machine on the Arc network. You pay USDC, watch a claw grab a sealed box, and open it into a pack of
        three cards. Every card is a real tokenized stock (an Astock token) paid straight to your wallet. Every play wins a
        box: the claw is theatre, and a smart contract decides what is inside, using verifiable randomness.
      </p>
      <p>
        The game is designed around three promises that the contracts enforce, not the website: the odds are fixed in a
        published table, every box is worth at least half of its price at the prices its table was set with, and the house
        always keeps a positive edge so the game can pay its prizes. This paper explains each of them, the machinery behind
        them, and the risks that remain.
      </p>

      <h2 id="play">2. How a play works</h2>
      <ol className="mt-4 list-decimal pl-5">
        <li>
          <strong>Connect.</strong> Log in with email, Google or X (a wallet is created for you) or connect your own wallet.
          Gas on Arc is paid in USDC, so one balance does everything.
        </li>
        <li>
          <strong>Pick a machine and pay.</strong> Three machines cost 1, 5 or 10 USDC per play. A play mints one sealed box
          to you. A box is a token you can hold, send or gift.
        </li>
        <li>
          <strong>Open.</strong> Opening burns the box and asks the randomness service for a number. The contract fixes the
          outcome table you were shown at that moment; if the table changed in between, the open is refused.
        </li>
        <li>
          <strong>Reveal.</strong> When the random number is in, the keeper reveals within seconds (you can reveal your own box at
          once, and anyone can after an hour). The contract picks a pack from the machine&apos;s table and sends you three
          Astock tokens. In the app you tear the pack and flip the cards.
        </li>
        <li>
          <strong>Keep, send or sell.</strong> The cards are ERC-20 tokens in your wallet. Keep them, send them, or sell them
          back to USDC on the Astock desk from the app.
        </li>
      </ol>
      <p>
        Boxes can be gifted to an address or through a claim link. A claim link carries a one-time key that signs the
        recipient&apos;s address, so nobody can front-run the claim, and the sender can reclaim an unclaimed box.
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
                  <th scope="row" className={`${td} font-normal`}>
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
      <p>What the contract enforces on every machine, whoever operates it:</p>
      <ul>
        <li>
          <strong>A floor.</strong> No outcome is worth less than 50 percent of the price at the prices its table was set
          with, and the floor is checked again against live prices when you open. The lowest outcome is built a little above
          the floor (52.65 percent) so ordinary price moves never break it.
        </li>
        <li>
          <strong>A cap.</strong> No outcome is worth more than 10 times the price.
        </li>
        <li>
          <strong>A return band.</strong> Each machine has its own narrow band for the expected return (for example 74 to 76
          percent for Single), checked at the largest possible luck boost. A table outside its band is rejected, so the odds
          cannot quietly be made worse than advertised, and the house edge cannot go negative.
        </li>
        <li>
          <strong>Rules that only tighten.</strong> The floor and the lower end of the band can be raised after launch, never
          lowered.
        </li>
      </ul>
      <p>
        These are guarantees about the table, measured in prices. Because prizes are stocks, what a card is worth in dollars
        moves with the market after you receive it.
      </p>

      <h2 id="randomness">4. Randomness</h2>
      <p>
        Outcomes come from the D20DAO verifiable randomness service (a VRF) on Arc, behind a small interface so it can be
        swapped. According to D20DAO, each epoch commits a round of the public drand beacon, and a fixed-input VRF binds a
        future block to the result; proofs are verified on chain and the whole thing can be replayed from public data by
        anyone. A request that is not fulfilled within 60 seconds becomes refundable.
      </p>
      <p>
        In arclaw, an open that is not answered can be retried a limited number of times, or you can take your boxes back. A third party keeper reveals fulfilled opens within seconds, so nobody holds a free option on an outcome they
        have already seen.
      </p>
      <p>
        The trust model is explicit: the randomness service has an operator, a beacon and an upgrade authority, and the
        contracts rely on them to deliver. Its guarantees are theirs; arclaw adds retry limits and refund paths so a failure
        costs you time, not boxes.
      </p>

      <h2 id="treasury">5. Prizes and the treasury</h2>
      <ul>
        <li>
          <strong>The box pays for its pack.</strong> Revenue from a play funds the prizes. When a revealed card&apos;s stock
          is not in inventory, the contract buys it on the Astock desk at that moment with the box revenue, within a price
          tolerance and per-reveal limits.
        </li>
        <li>
          <strong>Liabilities first.</strong> Money owed to players (unopened boxes, pending opens, credits, refunds) is
          reserved. The owner and the operator can withdraw or spend only what is left above those reserves, and never
          below a configured float.
        </li>
        <li>
          <strong>A float for big wins.</strong> A native USDC float covers the rare large prizes. Simulations of the real
          tables show a float of 500 USDC makes an out-of-money pause practically impossible at any volume, which is why it is
          the launch setting.
        </li>
        <li>
          <strong>If a prize cannot be bought</strong> (desk down, stale price, a limit hit), the card is paid in USDC at the
          lower of its table value and its last known price. Anything the contract cannot pay at once is written down as a
          claim and the machines pause until it is settled.
        </li>
        <li>
          <strong>Fresh tables.</strong> A table records when it was priced; opens refuse tables older than a day and any
          table whose stock prices have moved more than 5 percent. A keeper reprices the tables on a schedule and after
          market moves.
        </li>
        <li>
          <strong>Exits.</strong> If a machine is switched off, tables go stale or the contract stays paused for days, holders
          of unopened boxes can burn them for the price they paid.
        </li>
      </ul>

      <h2 id="security">6. Security model</h2>
      <p>
        Prizes are real money, so the contracts were built to be boring and to be attacked before anyone plays them.
      </p>
      <ul>
        <li>
          <strong>Review.</strong> The contracts went through six rounds of independent adversarial review by AI-assisted security
          reviewers (two independent reviewers per round, each writing exploit tests for what they found), plus a separate red-team pass over the whole
          system and its economics. Every finding became a test. The suite has nearly 200 tests, including invariant tests
          that fuzz play, open, reveal, refunds and withdrawals and check that the contract can always cover what it owes.
        </li>
        <li>
          <strong>No external audit yet.</strong> These reviews are not a substitute for a professional audit firm, and
          arclaw has not been audited by one. Treat the contracts as new software and play accordingly.
        </li>
        <li>
          <strong>Roles.</strong> The owner is a multi-signature Safe; ownership moves in two steps so it cannot be sent to a
          wrong address. An operator reprices tables inside the on-chain rules, a keeper reveals and retries, and a guardian
          can pause but never unpause. Renouncing ownership is disabled.
        </li>
        <li>
          <strong>Limits on every role.</strong> The operator and keeper cannot touch reserved funds, cannot make a table
          outside its band, and cannot lower the floor.
        </li>
        <li>
          <strong>On the website.</strong> A strict content policy, no framing, signed share links that only show packs read
          from the chain, a region gate and an age confirmation before the app.
        </li>
      </ul>
      <p>
        What can still go wrong: a bug nobody found, the randomness service failing or misbehaving, the Astock tokens, desk or
        oracle failing or being paused, the Arc network, a compromised key. The risks section lists them.
      </p>

      <h2 id="token">7. The ARCLAW token</h2>
      <p>
        {ARCLAW_SYMBOL} is arclaw&apos;s token. It launches with mainnet, minted on Arguspad; its contract address is published
        on this site and on the project&apos;s X account when it exists, and until then nothing else is {ARCLAW_SYMBOL}.
      </p>
      <ul>
        <li>
          <strong>Luck boost, in the contract.</strong> Staking ARCLAW in the vault for at least a day gives each box you open
          a chance (up to 1 percent at the top tier) to draw a second pack and keep the better one. At the top tier that is
          worth about 0.16 percentage points of return, roughly 1.6 USDC per 1,000 USDC played. It is small by design: every
          machine&apos;s table is checked at the maximum boost, so it can never break the guarantees. A stake only counts
          after a day, so borrowed or just-bought tokens earn nothing.
        </li>
        <li>
          <strong>Buyback and holder share, by the team.</strong> The team&apos;s policy is to use 25 percent of each month&apos;s
          net profit to buy ARCLAW on the market and to share another 10 percent with ARCLAW holders, increasing both as
          profit grows. This is run by the team outside the contracts, is not enforced on chain, can change or stop, and is
          not a promise: in a month with no net profit there is nothing to buy or share.
        </li>
        <li>
          <strong>Not an investment.</strong> ARCLAW is not a share or a claim on arclaw. It can lose all of its value.
        </li>
      </ul>
      <p>Total supply, allocation and the launch plan are announced with the token.</p>

      <h2 id="roadmap">8. Roadmap</h2>
      <ol className="mt-4 list-decimal pl-5">
        <li>
          <strong>Testnet.</strong> The full product on Arc testnet with mock stocks: play, open, reveal, sell, gift, leaderboard,
          the keeper and the Telegram bot.
        </li>
        <li>
          <strong>Mainnet, closed test.</strong> Deployed paused. The team plays with its own funds against the real Astock
          desk and oracle before anyone else.
        </li>
        <li>
          <strong>Public launch.</strong> Machines open, ARCLAW launches, the contract addresses are published.
        </li>
        <li>
          <strong>After launch.</strong> A professional audit, larger buybacks as profit allows, and more machines and stocks.
          None of this is a commitment on timing.
        </li>
      </ol>

      <h2 id="risks">9. Risks and limits</h2>
      <ul>
        <li>
          <strong>You can lose money.</strong> On average a box returns less than its price. Most boxes are worth less than
          the play price. Only play with money you can afford to lose.
        </li>
        <li>
          <strong>Stocks move.</strong> Cards are tokenized stocks issued by Astock. They are not shares, they can fall in
          value, and they depend on Astock&apos;s reserves, issuers and bridges. A token can be paused or delisted.
        </li>
        <li>
          <strong>Smart contract and service risk.</strong> Contracts, the randomness service, oracles, wallets and the Arc
          network can fail or be attacked. Blockchain transactions cannot be reversed.
        </li>
        <li>
          <strong>Legal.</strong> A paid game of chance with prizes of value is regulated, licensed or forbidden in many
          places. The app is not offered in some regions and you must be 18 or older. You are responsible for what is lawful
          where you are and for taxes on what you win or sell. Nothing here is financial, legal or tax advice.
        </li>
        <li>
          <strong>Governance of the team.</strong> Parameters such as tables, the float and caps are set by the owner within
          the on-chain rules above. The rules protect you from the worst changes, not from all of them.
        </li>
      </ul>
      <p>
        Read the <a href="/disclaimer">risk disclaimer</a> and the <a href="/privacy">privacy policy</a> before you play.
      </p>

      <h2 id="contracts">10. Contracts</h2>
      {c ? (
        <>
          <p>Deployed on {ARC.chain.name}.</p>
          <div className="mt-4 overflow-hidden rounded-[14px] border border-line bg-panel">
            <table className="w-full border-collapse">
              <tbody>
                {(
                  [
                    ["arclaw", c.arclaw],
                    ["Price source", c.priceSource],
                    ["Astock desk", c.desk],
                    ["Randomness coordinator", c.vrfCoordinator],
                  ] as const
                ).map(([name, address]) => (
                  <tr key={name} className="border-b border-line last:border-b-0">
                    <th scope="row" className={`${td} font-normal text-muted`}>
                      {name}
                    </th>
                    <td className={`${td} money break-all`}>
                      <a href={explorerAddress(address, ARC)} target="_blank" rel="noreferrer">
                        {address}
                      </a>
                    </td>
                  </tr>
                ))}
                {ARCLAW_TOKEN ? (
                  <tr className="border-b border-line last:border-b-0">
                    <th scope="row" className={`${td} font-normal text-muted`}>
                      {ARCLAW_SYMBOL}
                    </th>
                    <td className={`${td} money break-all`}>
                      <a href={explorerAddress(ARCLAW_TOKEN, ARC)} target="_blank" rel="noreferrer">
                        {ARCLAW_TOKEN}
                      </a>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p>The mainnet contract addresses are published here at launch.</p>
      )}
      <p>
        Source and tests are in the project repository. The randomness service is <a href="https://d20dao.org">D20DAO</a>, the
        chain is <a href="https://www.arc.io">Arc</a> and the stocks are <a href="https://astock.fi">Astock</a>.
      </p>
    </>
  );
}
