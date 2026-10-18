/**
 * Public claim page for gift links. The query (machine, count, note) is not secret and drives the share card; the
 * key after the # never reaches the server (components/app/ClaimView.tsx).
 */
import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { ClaimView } from "@/components/app/ClaimView";
import { parseGift } from "@/lib/og/cards";

type Search = Promise<Record<string, string | string[] | undefined>>;

const toParams = (s: Record<string, string | string[] | undefined>) => {
  const p = new URLSearchParams();
  if (typeof s.m === "string") p.set("machine", s.m);
  if (typeof s.n === "string") p.set("n", s.n);
  if (typeof s.note === "string") p.set("note", s.note);
  return p;
};

export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const p = toParams(await searchParams);
  const g = parseGift(p);
  const title = g.count === 1 ? `A sealed ${g.machine.name} box for you` : `${g.count} sealed ${g.machine.name} boxes for you`;
  const image = { url: `/api/og/gift?${p.toString()}`, width: 1200, height: 630, alt: title };
  return { title, robots: { index: false }, openGraph: { title, images: [image] }, twitter: { card: "summary_large_image", title, images: [image] } };
}

export default async function ClaimPage({ searchParams }: { searchParams: Search }) {
  const g = parseGift(toParams(await searchParams));
  return (
    <AppShell>
      <ClaimView machineSlug={g.machine.slug} boxes={g.count} note={g.note} />
    </AppShell>
  );
}
