/**
 * One machine's page (server): the cabinet art for its finish and the machine from lib/machines.json, handed to
 * MachineRoom. Used by /app/play/single, /stack and /vault (static routes; a dynamic [machine] segment crashes the
 * dev server's static-paths worker in this setup).
 */
import { notFound } from "next/navigation";
import { clawArt } from "@/components/claw/geometry";
import { variantOf } from "@/components/claw/view";
import { MachineRoom } from "./MachineRoom";
import { withResolved } from "@/lib/machines.server";

export function machineTitle(slug: string) {
  const m = withResolved().find((x) => x.slug === slug);
  return m ? `${m.name} machine` : "Machine";
}

export function MachinePage({ slug }: { slug: string }) {
  const m = withResolved().find((x) => x.slug === slug);
  if (!m) notFound();
  return <MachineRoom art={clawArt(variantOf(m.slug))} machine={m} />;
}
