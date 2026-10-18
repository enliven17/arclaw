import type { Metadata } from "next";
import { Collection } from "@/components/app/Collection";

export const metadata: Metadata = {
  title: "Collection",
  description: "View the tokenized stocks and sealed-box history in your connected arclaw wallet.",
  alternates: { canonical: "/app/collection" },
  robots: { index: false, follow: true },
};

export default function Page() {
  return <Collection />;
}
