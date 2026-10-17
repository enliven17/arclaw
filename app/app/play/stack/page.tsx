import type { Metadata } from "next";
import { MachinePage, machineTitle } from "@/components/app/MachinePage";

export const metadata: Metadata = { title: machineTitle("stack") };

export default function Page() {
  return <MachinePage slug="stack" />;
}
