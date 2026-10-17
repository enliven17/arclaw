import type { Metadata } from "next";
import { MachinePage, machineTitle } from "@/components/app/MachinePage";

export const metadata: Metadata = { title: machineTitle("vault") };

export default function Page() {
  return <MachinePage slug="vault" />;
}
