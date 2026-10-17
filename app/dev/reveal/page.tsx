/** Visual QA for the reveal with sample boxes (no wallet, no chain). Development only; production answers 404. */
import { notFound } from "next/navigation";
import { RevealDemo } from "./RevealDemo";

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <RevealDemo />;
}
