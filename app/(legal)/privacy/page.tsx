import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What arclaw collects, why, and what you can do about it.",
  alternates: { canonical: "/privacy" },
};

const UPDATED = "19 November 2026";

export default function Privacy() {
  return (
    <>
      <Breadcrumbs className="mb-10" items={[{ label: "Home", href: "/" }, { label: "Privacy policy", href: "/privacy" }]} />
      <h1>Privacy policy</h1>
      <p className="lede">Last updated {UPDATED}. We collect as little as we can and never sell what we have.</p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Wallet address and on-chain activity.</strong> When you connect a wallet we see its public address. Plays,
          boxes, prizes, gifts and sales happen on the Solana blockchain, which is public; we read and index those events to
          show your collection and the leaderboard.
        </li>
        <li>
          <strong>Gift details.</strong> If you send a gift, the note you write and the machine and number of boxes are
          used to draw the gift card and its link preview. A claim link carries its secret after the # in the address,
          which browsers never send to our servers.
        </li>
        <li>
          <strong>Telegram.</strong> If you use the arclaw bot, we receive your Telegram user id, username and the
          messages you send to the bot, so it can reply and notify you.
        </li>
        <li>
          <strong>Basic technical data.</strong> Our hosting provider processes IP addresses, browser type and request
          logs to serve the site, keep it secure and limit abuse.
        </li>
        <li>
          <strong>Settings on your device.</strong> We store small preferences in your browser (sound on or off, whether
          you have seen the intro). A round also keeps its limited session key in your browser so it can be resumed.
          These keys and preferences are not sent to our servers.
        </li>
      </ul>

      <h2>What we do not collect</h2>
      <p>
        We never ask for or see your private keys or seed phrase. Your wallet stays yours; we only learn its public
        address. We do not use advertising trackers and we do not sell or rent
        personal data.
      </p>

      <h2>Why we use it</h2>
      <p>
        To run the game, show your boxes and cards, deliver gifts, rank the leaderboard, prevent fraud and abuse, comply
        with law (including sanctions screening and regional restrictions), and fix problems.
      </p>

      <h2>Who else processes it</h2>
      <ul>
        <li>Vercel (hosting) and Convex (database) store and serve the app.</li>
        <li>
          Your wallet app (such as Phantom, Solflare or Backpack) connects you and signs your transactions, including
          through Mobile Wallet Adapter on Android.
        </li>
        <li>
          Solana RPC providers relay your transactions and our reads of the chain. MagicBlock runs the ephemeral rollup
          your claw rounds play on and provides randomness.
        </li>
        <li>Circle issues USDC. Devnet stock tokens are project test mints. Future mainnet prizes are intended to use xStocks. Display prices currently use stored snapshots.</li>
        <li>Jupiter, if you sell a card from the app.</li>
        <li>Telegram, if you use the bot.</li>
      </ul>
      <p>Each handles data under its own privacy policy.</p>

      <h2>How long we keep it</h2>
      <p>
        Indexed on-chain data is kept for as long as the service runs; the blockchain itself keeps it permanently and we
        cannot delete it. Server logs are kept for a limited period for security. Telegram data is kept while you use the
        bot and deleted on request.
      </p>

      <h2>Your choices</h2>
      <p>
        You can disconnect your wallet at any time, clear the settings stored in your browser, and stop the bot by
        blocking it in Telegram. Depending on where you live you may have the right to access, correct or delete
        personal data we hold, or to object to its use. Data written to the blockchain cannot be changed or deleted by
        anyone.
      </p>

      <h2>Children</h2>
      <p>arclaw is only for adults. We do not knowingly collect data from anyone under 18.</p>

      <h2>Changes</h2>
      <p>We will update this page when our practices change and change the date at the top.</p>
    </>
  );
}
