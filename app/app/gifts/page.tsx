import type { Metadata } from "next";
import { GiftComposer } from "@/components/app/GiftComposer";
import { MACHINES } from "@/lib/machines";

export const metadata: Metadata = {
  title: "Gifts",
  description: "Send sealed arclaw boxes to an Arc address or create a claim link for a friend.",
  alternates: { canonical: "/app/gifts" },
  robots: { index: false, follow: true },
};

export default async function Page({ searchParams }: PageProps<"/app/gifts">) {
  const s = await searchParams;
  const initial = typeof s.machine === "string" ? s.machine : undefined;
  const machines = MACHINES.map(({ id, name, slug, priceUsdc }) => ({ id, name, slug, priceUsdc }));
  return <GiftComposer machines={machines} initial={initial} />;
}
