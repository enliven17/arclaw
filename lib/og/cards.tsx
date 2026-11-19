/**
 * The share cards: the site card (app/opengraph-image.tsx, twitter-image.tsx), a pull (api/og/pull) and a gift
 * (api/og/gift). Parsing of untrusted query params lives here too, so every route validates the same way.
 */
import { MACHINES, examplePack, machineBySlug, type Machine } from "@/lib/machines";
import { withResolved } from "@/lib/machines.server";
import { stockOf, usdc, type PullCard } from "@/lib/stocks";
import { OgBox, OgCard, OgFrame } from "./frame";
import { CLAW, CREAM, MUTED } from "./palette";

const TICKER = /^[A-Z]{1,6}$/;
const MAX_AMOUNT = 100_000;
const TIER = /^[A-Za-z]{1,16}$/;

const defaultPull = () => {
  const m = withResolved()[0]!;
  const t = m.tiers[Math.min(2, m.tiers.length - 1)]!;
  return { cards: examplePack(m, t), tier: t.name };
};

/** `tickers=NVDA,AAPL,TSLA&amounts=0.10,0.40,0.25&tier=Rare`. Anything malformed falls back to an example pack. */
export function parsePull(params: URLSearchParams): { cards: PullCard[]; tier: string } {
  const tickers = (params.get("tickers") ?? "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  const amounts = (params.get("amounts") ?? "").split(",").map((a) => Number(a.trim()));
  const tierRaw = params.get("tier") ?? "";
  if (tickers.length !== 3 || amounts.length !== 3) return defaultPull();
  const ok = tickers.every((t) => TICKER.test(t)) && amounts.every((a) => Number.isFinite(a) && a >= 0 && a <= MAX_AMOUNT);
  if (!ok) return defaultPull();
  const tier = TIER.test(tierRaw) ? tierRaw[0]!.toUpperCase() + tierRaw.slice(1).toLowerCase() : "Pack";
  return { cards: tickers.map((t, i) => ({ ticker: t, name: stockOf(t).name, amount: Math.round(amounts[i]! * 100) / 100 })), tier };
}

export type GiftParams = { machine: Machine; count: number; note: string | null; from: string | null };

const clean = (raw: string | null, max: number) => (raw ?? "").normalize("NFKC").replace(/[^\p{L}\p{N} _@'!?,.-]/gu, "").replace(/\s+/g, " ").trim().slice(0, max) || null;

/** `machine=stack&n=2&note=Happy%20birthday&from=Ada`, all optional and sanitised. The claim secret never goes here. */
export function parseGift(params: URLSearchParams): GiftParams {
  const machine = machineBySlug((params.get("machine") ?? "").toLowerCase()) ?? MACHINES[0]!;
  const n = Math.round(Number(params.get("n") ?? 1));
  return { machine, count: Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 1, note: clean(params.get("note"), 80), from: clean(params.get("from"), 24) };
}

const Headline = ({ lines, size = 72 }: { lines: string[]; size?: number }) => (
  <div style={{ display: "flex", flexDirection: "column", fontSize: size, fontWeight: 500, lineHeight: 1, letterSpacing: -size * 0.036, color: CREAM }}>
    {lines.map((l) => (
      <span key={l}>{l}</span>
    ))}
  </div>
);

export function SiteCard() {
  const m = withResolved()[0]!;
  const tiers = m.tiers;
  const pack = [examplePack(m, tiers[1]!, 1)[0]!, examplePack(m, tiers[tiers.length - 1]!)[0]!, examplePack(m, tiers[2]!, 2)[0]!];
  const names = [tiers[1]!.name, tiers[tiers.length - 1]!.name, tiers[2]!.name];
  return (
    <OgFrame eyebrow="Claw machines on Solana" footer={`Three machines: ${MACHINES.map((x) => `${x.priceUsdc} USDC`).join(", ")}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 560 }}>
          <Headline lines={["Grab a box.", "Pull real stocks."]} />
          <div style={{ display: "flex", marginTop: 26, fontSize: 26, lineHeight: 1.35, color: MUTED }}>Every play wins a sealed pack of three tokenized stocks.</div>
        </div>
        {/* Satori has no z-index: paint order is DOM order, so the centre card comes last to sit on top. */}
        <div style={{ display: "flex", position: "relative", width: 480, height: 330 }}>
          <div style={{ display: "flex", position: "absolute", left: 0, top: 30 }}>
            <OgCard card={pack[0]!} tier={names[0]!} width={190} rotate={-8} />
          </div>
          <div style={{ display: "flex", position: "absolute", left: 290, top: 30 }}>
            <OgCard card={pack[2]!} tier={names[2]!} width={190} rotate={8} />
          </div>
          <div style={{ display: "flex", position: "absolute", left: 135, top: 0 }}>
            <OgCard card={pack[1]!} tier={names[1]!} width={210} />
          </div>
        </div>
      </div>
    </OgFrame>
  );
}

export function PullCardImage({ cards, tier }: { cards: PullCard[]; tier: string }) {
  const total = cards.reduce((s, c) => s + c.amount, 0);
  return (
    <OgFrame eyebrow={`${tier} pack opened`} footer={`${usdc(total)} USDC in tokenized stocks`}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 360 }}>
          <Headline lines={["Pulled", `${usdc(total)} USDC`]} size={68} />
          <div style={{ display: "flex", marginTop: 22, fontSize: 26, color: MUTED }}>{cards.map((c) => c.ticker).join(", ")}</div>
        </div>
        <div style={{ display: "flex", gap: 20 }}>
          {cards.map((c, i) => (
            <OgCard key={`${c.ticker}-${i}`} card={c} tier={tier} width={220} />
          ))}
        </div>
      </div>
    </OgFrame>
  );
}

export function GiftCardImage({ machine, count, note, from }: GiftParams) {
  const boxes = count === 1 ? `a sealed ${machine.name} box.` : `${count} sealed ${machine.name} boxes.`;
  return (
    <OgFrame eyebrow="A gift on arclaw" footer="Claim it to open three stocks per box.">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 660 }}>
          <Headline lines={[from ? `${from} sent you` : "You got", boxes]} size={64} />
          {note ? (
            <div style={{ display: "flex", marginTop: 26, fontSize: 28, lineHeight: 1.35, color: CREAM }}>{`"${note}"`}</div>
          ) : (
            <div style={{ display: "flex", marginTop: 26, fontSize: 26, lineHeight: 1.35, color: MUTED }}>Inside each: a pack of three cards, each a real tokenized stock.</div>
          )}
          <div style={{ display: "flex", marginTop: 32 }}>
            <div style={{ display: "flex", padding: "14px 24px", borderRadius: 10, backgroundColor: CLAW, color: "#0C0C0E", fontSize: 24, fontWeight: 500 }}>
              {count === 1 ? "Claim your box" : "Claim your boxes"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginRight: 30 }}>
          <OgBox size={270} />
          <div style={{ display: "flex", marginTop: 18, fontFamily: "Geist Mono", fontSize: 22, color: MUTED }}>{`${count} x ${machine.priceUsdc} USDC`}</div>
        </div>
      </div>
    </OgFrame>
  );
}
