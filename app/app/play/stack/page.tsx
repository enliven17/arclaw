import type { Metadata } from "next";
import { MachinePage, machineDescription, machineTitle } from "@/components/app/MachinePage";

export const metadata: Metadata = { title: machineTitle("stack"), description: machineDescription("stack"), alternates: { canonical: "/app/play/stack" } };

export default function Page() {
  return <MachinePage slug="stack" />;
}
