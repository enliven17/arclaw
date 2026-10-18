/** Shown (with a 451) by proxy.ts to visitors from regions where the app is not offered. */
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not available in your region", robots: { index: false, follow: false } };

export default function RestrictedPage() {
  return (
    <main id="main" className="wrap flex min-h-dvh flex-col items-center justify-center gap-8 py-20 text-center">
      <h1 className="h-section !text-[clamp(36px,4.6vw,72px)]">Not available in your region.</h1>
      <p className="lede max-w-[30em]">
        arclaw is a game of chance with prizes of value, and we do not offer it to people in your region. You can still read how
        it works and what the odds are.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn">
          Back to the site
        </Link>
        <Link href="/disclaimer" className="btn-ghost">
          Risk disclaimer
        </Link>
      </div>
    </main>
  );
}
