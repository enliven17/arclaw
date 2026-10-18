import { X_HANDLE, X_URL } from "@/lib/seo";

/** A transparent team bio that does not invent an individual author or credentials. */
export function AuthorBio() {
  return (
    <section id="about" aria-labelledby="about-title" className="border-t border-line py-28 md:py-36">
      <div className="wrap grid gap-8 md:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] md:items-start">
        <div>
          <h2 id="about-title" className="h-section">
            Built by the arclaw team.
          </h2>
          <p className="lede mt-7 max-w-[32em]">
            arclaw is an independent on-chain arcade. The project team maintains the web app, smart contracts, payout tables, and tools that make each play verifiable on Arc.
          </p>
        </div>
        <div className="text-[15px] leading-relaxed text-muted">
          <p>Follow {X_HANDLE} for launch updates and contract changes.</p>
          <a href={X_URL} rel="noopener noreferrer" target="_blank" className="mt-4 inline-block text-cream underline underline-offset-4">
            Meet the team on X
          </a>
        </div>
      </div>
    </section>
  );
}
