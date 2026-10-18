import type { Metadata } from "next";
import { MachinePage, machineDescription, machineTitle } from "@/components/app/MachinePage";

export const metadata: Metadata = { title: machineTitle("single"), description: machineDescription("single"), alternates: { canonical: "/app/play/single" } };

export default function Page() {
  return <MachinePage slug="single" />;
}
