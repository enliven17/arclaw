/** Visual QA for the reveal with sample boxes (no wallet, no chain). Development only; production answers 404. */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RevealDemo } from "./RevealDemo";

export const metadata: Metadata = { title: "Reveal demo", description: "Internal arclaw visual QA page.", robots: { index: false, follow: false } };

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <RevealDemo />;
}
