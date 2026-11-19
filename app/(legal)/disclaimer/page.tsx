import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";

export const metadata: Metadata = {
  title: "Risk disclaimer",
  description: "What you are buying when you play arclaw, and the risks that come with it.",
  alternates: { canonical: "/disclaimer" },
};

const UPDATED = "19 November 2026";

export default function Disclaimer() {
  return (
    <>
      <Breadcrumbs className="mb-10" items={[{ label: "Home", href: "/" }, { label: "Risk disclaimer", href: "/disclaimer" }]} />
      <h1>Risk disclaimer</h1>
      <p className="lede">Last updated {UPDATED}. Please read this before you play.</p>

      <h2>What a play is</h2>
      <p>
        Each play costs a fixed amount of USDC on Solana (1, 5 or 10 USDC, depending on the machine) and always gives you
        one sealed box. Network fees are paid in SOL. A box opens into a pack of three cards. Each card is a transfer of a
        tokenized stock to your wallet. You steer the claw yourself, but where it lands does not change anything: the
        contents of every box are decided by the arclaw program using verifiable randomness, not by skill.
      </p>

      <h2>You can get back less than you paid</h2>
      <p>
        The contract guarantees that every box is worth at least half of what you paid for that machine, measured at the
        values recorded when the prize table was set, and never more than ten times. On average a box returns less than its
        price; the expected return of each machine is published in the odds table and enforced on-chain. Most boxes are
        worth less than the play price. Do not play with money you cannot afford to lose, and do not play expecting a
        profit.
      </p>

      <h2>Tokenized stocks are not shares</h2>
      <p>
        On mainnet, prizes are xStocks: tokens issued by Backed on Solana, each designed to track one stock or fund and
        backed by the underlying held in reserve. Holding them does not make you a shareholder of the company: you do not
        get voting rights, and you rely on the issuer, its reserves and its custodians to keep each token redeemable.
        Their value moves with the market and can fall. On devnet, prizes are test tokens with no value. Prices shown on
        arclaw come from third parties and may be delayed or wrong. arclaw does not issue, custody or redeem these tokens.
      </p>

      <h2>Randomness and smart contracts</h2>
      <p>
        Outcomes use a third party randomness service (MagicBlock VRF), and each round runs on a MagicBlock ephemeral
        rollup before it is committed back to Solana. Programs, rollups, randomness providers, wallets and the Solana
        network can fail, be attacked, be paused or behave unexpectedly. Transactions on a blockchain are final; arclaw
        cannot reverse them. If a draw does not arrive within two minutes, the round is void and your box comes back.
      </p>

      <h2>Eligibility</h2>
      <p>
        You must be at least 18 years old, or the age of majority where you live if higher. Games where you pay for a
        chance to win something of value are restricted or illegal in many places. You may not play if this is not
        lawful where you are, if you are on a sanctions list, or if you live in or are located in a country under
        comprehensive sanctions. Do not use a VPN or other tools to get around these limits. The app is not offered in some
        regions and we block access from them; being able to open it does not mean it is lawful where you are.
      </p>

      <h2>Not advice</h2>
      <p>
        Nothing on arclaw is investment, financial, legal or tax advice, and nothing here is an offer to buy or sell
        securities. You are responsible for any taxes on what you win or sell.
      </p>

      <h2>Play responsibly</h2>
      <p>
        Set a budget before you play and stop when you reach it. If playing stops being fun, take a break. If you think
        you may have a gambling problem, contact a local support service such as BeGambleAware or the National Council
        on Problem Gambling.
      </p>
    </>
  );
}
