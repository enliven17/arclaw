/**
 * The three share cards: the site card (app/opengraph-image.tsx, twitter-image.tsx), a pull (api/og/pull) and a
 * gift (api/og/gift). Parsing of untrusted query params lives here too, so every route validates the same way.
 */
import { SAMPLE_PACK, stockOf, usdc, type PullCard } from "@/lib/stocks";
import { OgBox, OgCard, OgFrame } from "./frame";
import { CLAW, CREAM, MUTED } from "./palette";

const TICKER = /^[A-Z][A-Z.]{0,5}$/;
const MAX_AMOUNT = 1000;

/** `tickers=NVDA,AAPL,TSLA&amounts=0.10,0.40,0.25`. Anything malformed falls back to the sample pack. */
export function parsePull(params: URLSearchParams): PullCard[] {
  const tickers = (params.get("tickers") ?? "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  const amounts = (params.get("amounts") ?? "").split(",").map((a) => Number(a.trim()));
  if (tickers.length !== 3 || amounts.length !== 3) return [...SAMPLE_PACK];
  const ok = tickers.every((t) => TICKER.test(t)) && amounts.every((a) => Number.isFinite(a) && a >= 0 && a <= MAX_AMOUNT);
  if (!ok) return [...SAMPLE_PACK];
  return tickers.map((t, i) => ({ ticker: t, name: stockOf(t).name, amount: Math.round(amounts[i]! * 100) / 100 }));
}

/** A display name for a gift sender: letters, digits, spaces and a few marks, at most 24 characters. */
export function parseFrom(params: URLSearchParams): string | null {
  const raw = (params.get("from") ?? "").normalize("NFKC").replace(/[^\p{L}\p{N} _@'-]/gu, "").trim().slice(0, 24);
  return raw || null;
}

const Headline = ({ lines }: { lines: string[] }) => (
  <div style={{ display: "flex", flexDirection: "column", fontSize: 72, fontWeight: 500, lineHeight: 1, letterSpacing: -2.6, color: CREAM }}>
    {lines.map((l) => (
      <span key={l}>{l}</span>
    ))}
  </div>
);

export function SiteCard() {
  const [a, b, c] = SAMPLE_PACK;
  return (
    <OgFrame eyebrow="Claw machine on Arc" footer="Pay 1 USDC. Win a box of real stocks.">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 560 }}>
          <Headline lines={["Play the claw.", "Win real stocks."]} />
          <div style={{ display: "flex", marginTop: 26, fontSize: 26, lineHeight: 1.35, color: MUTED }}>Every box opens into three cards. Every card is a tokenized stock.</div>
        </div>
        {/* Satori has no z-index: paint order is DOM order, so the foil card comes last to sit on top. */}
        <div style={{ display: "flex", position: "relative", width: 460, height: 330 }}>
          <div style={{ display: "flex", position: "absolute", left: 0, top: 40 }}>
            <OgCard card={a!} width={180} rotate={-8} index={0} />
          </div>
          <div style={{ display: "flex", position: "absolute", left: 280, top: 40 }}>
            <OgCard card={c!} width={180} rotate={8} index={2} />
          </div>
          <div style={{ display: "flex", position: "absolute", left: 125, top: 0 }}>
            <OgCard card={b!} width={210} foil index={1} />
          </div>
        </div>
      </div>
    </OgFrame>
  );
}

export function PullCardImage({ cards }: { cards: PullCard[] }) {
  const total = cards.reduce((s, c) => s + c.amount, 0);
  const best = cards.reduce((m, c, i) => (c.amount > cards[m]!.amount ? i : m), 0);
  return (
    <OgFrame eyebrow="Pack opened" footer={`${usdc(total)} USDC in stocks from one 1 USDC box`}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 330 }}>
          <Headline lines={["Pulled", `${cards.map((c) => c.ticker).join(" ")}`]} />
          <div style={{ display: "flex", marginTop: 22, fontFamily: "Geist Mono", fontSize: 30, color: CREAM }}>{`${usdc(total)} USDC`}</div>
        </div>
        <div style={{ display: "flex", gap: 22 }}>
          {cards.map((c, i) => (
            <OgCard key={`${c.ticker}-${i}`} card={c} width={210} foil={i === best} index={i} />
          ))}
        </div>
      </div>
    </OgFrame>
  );
}

export function GiftCardImage({ from }: { from: string | null }) {
  return (
    <OgFrame eyebrow="A gift on arclaw" footer="Claim it to open three stocks.">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 620 }}>
          <Headline lines={from ? [`${from} sent you`, "a sealed box."] : ["Someone sent you", "a sealed box."]} />
          <div style={{ display: "flex", marginTop: 26, fontSize: 26, lineHeight: 1.35, color: MUTED }}>Inside: a pack of three cards, each a real tokenized stock.</div>
          <div style={{ display: "flex", marginTop: 34 }}>
            <div style={{ display: "flex", padding: "14px 24px", borderRadius: 10, backgroundColor: CLAW, color: "#0C0C0E", fontSize: 24, fontWeight: 500 }}>Claim your box</div>
          </div>
        </div>
        <div style={{ display: "flex", marginRight: 30 }}>
          <OgBox size={300} />
        </div>
      </div>
    </OgFrame>
  );
}
