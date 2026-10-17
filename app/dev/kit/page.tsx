/**
 * Visual QA for the reveal kit: the three sealed boxes, the booster pack and a pack's cards, side by side.
 * Development only; production builds answer 404.
 */
import { notFound } from "next/navigation";
import { BoosterPack } from "@/components/pack/BoosterPack";
import { SealedBox } from "@/components/pack/SealedBox";
import { StockCard } from "@/components/landing/StockCard";
import { MACHINES, examplePack } from "@/lib/machines";
import { VARIANTS } from "@/components/claw/view";

export default function Kit() {
  if (process.env.NODE_ENV === "production") notFound();
  const m = MACHINES[2]!;
  const tier = m.tiers[m.tiers.length - 1]!;
  return (
    <main className="wrap grid gap-16 py-16">
      <section className="grid grid-cols-3 gap-8">
        {VARIANTS.map((v) => (
          <SealedBox key={v} variant={v} />
        ))}
      </section>
      <section className="grid grid-cols-3 items-end gap-8">
        {MACHINES.map((x, i) => (
          <BoosterPack key={x.id} machine={x.name} tiers={x.tiers.length} uid={`kit-${i}`} />
        ))}
        <BoosterPack machine={m.name} tiers={m.tiers.length} tier={m.tiers.length - 1} uid="kit-tier" />
      </section>
      <section className="grid grid-cols-3 gap-8">
        {examplePack(m, tier).map((c, i) => (
          <StockCard key={i} card={c} tier={tier.name} index={i} />
        ))}
      </section>
    </main>
  );
}
