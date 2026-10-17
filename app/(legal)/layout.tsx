import type { ReactNode } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

/** Plain reading layout for the legal pages: header, one narrow column, the links between them. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="wrap pb-24 pt-36">
        <article className="legal mx-auto max-w-[720px]">{children}</article>
        <nav className="mx-auto mt-16 flex max-w-[720px] gap-6 border-t border-cream/8 pt-6 text-[15px] text-muted">
          <Link className="transition-colors hover:text-cream" href="/disclaimer">
            Risk disclaimer
          </Link>
          <Link className="transition-colors hover:text-cream" href="/privacy">
            Privacy policy
          </Link>
          <Link className="transition-colors hover:text-cream" href="/">
            Home
          </Link>
        </nav>
      </main>
    </>
  );
}
