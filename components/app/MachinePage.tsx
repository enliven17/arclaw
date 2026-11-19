/**
 * One machine's page (server): the cabinet art for its finish and the machine from lib/machines.json, handed to
 * MachineRoom. Used by /app/play/single, /stack and /vault (static routes; a dynamic [machine] segment crashes the
 * dev server's static-paths worker in this setup).
 */
import { notFound } from "next/navigation";
import { clawArt } from "@/components/claw/geometry";
import { variantOf } from "@/components/claw/view";
import { Breadcrumbs } from "@/components/seo/Breadcrumbs";
import { MachineRoom } from "./MachineRoom";
import { withResolved } from "@/lib/machines.server";

export function machineTitle(slug: string) {
  const m = withResolved().find((x) => x.slug === slug);
  return m ? `${m.name} machine` : "Machine";
}

export function machineDescription(slug: string) {
  const m = withResolved().find((x) => x.slug === slug);
  return m
    ? `Play the ${m.name} machine for ${m.priceUsdc} USDC on Solana. Every play gives one sealed box with three tokenized stock cards.`
    : "Play an arclaw machine with USDC on Solana and open sealed boxes into tokenized stock cards.";
}

export function MachinePage({ slug }: { slug: string }) {
  const m = withResolved().find((x) => x.slug === slug);
  if (!m) notFound();
  return (
    <>
      <div className="wrap pt-8">
        <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Machines", href: "/app/play" }, { label: m.name, href: `/app/play/${m.slug}` }]} />
      </div>
      <MachineRoom art={clawArt(variantOf(m.slug))} machine={m} />
    </>
  );
}
