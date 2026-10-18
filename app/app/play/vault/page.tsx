import type { Metadata } from "next";
import { MachinePage, machineDescription, machineTitle } from "@/components/app/MachinePage";

export const metadata: Metadata = { title: machineTitle("vault"), description: machineDescription("vault"), alternates: { canonical: "/app/play/vault" } };

export default function Page() {
  return <MachinePage slug="vault" />;
}
