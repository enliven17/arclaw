"use client";

import { useState } from "react";
import { RevealOverlay } from "@/components/app/RevealOverlay";
import type { DrawnBox } from "@/lib/solana/client";

const card = (ticker: string, name: string, usd: number) => ({ ticker, name, mint: "11111111111111111111111111111111", amount: 1n, paid: true, valueUsdc: usd });

const SAMPLE: Record<string, DrawnBox[]> = {
  rare: [{ machineId: 1, boxIndex: 0, tier: 2, tierName: "Rare", valueUsdc: 1, cards: [card("NVDA", "NVIDIA", 0.45), card("AAPL", "Apple", 0.33), card("TSLA", "Tesla", 0.22)] }],
  jackpot: [{ machineId: 3, boxIndex: 0, tier: 5, tierName: "Jackpot", valueUsdc: 100, cards: [card("NVDA", "NVIDIA", 45), card("MSFT", "Microsoft", 33), card("META", "Meta Platforms", 22)] }],
  many: [0, 1, 2].map((i) => ({ machineId: 2, boxIndex: i, tier: i, tierName: ["Common", "Uncommon", "Rare"][i]!, valueUsdc: 0, cards: [card("SPY", "S&P 500 ETF", 1 + i), card("QQQ", "Nasdaq 100 ETF", 0.8 + i), card("GOOGL", "Alphabet", 0.7 + i)] })),
};

export function RevealDemo() {
  const kind = typeof window === "undefined" ? "rare" : (new URLSearchParams(window.location.search).get("kind") ?? "rare");
  const [open, setOpen] = useState(true);
  const boxes = SAMPLE[kind] ?? SAMPLE.rare!;
  const machine = { name: ["Single", "Single", "Stack", "Vault"][boxes[0]!.machineId]!, slug: ["single", "single", "stack", "vault"][boxes[0]!.machineId]! };
  return (
    <main className="wrap py-20">
      <button type="button" className="btn-cream" onClick={() => setOpen(true)}>
        Open the reveal
      </button>
      <RevealOverlay open={open} machine={machine} boxes={boxes} waiting={null} onClose={() => setOpen(false)} />
    </main>
  );
}
