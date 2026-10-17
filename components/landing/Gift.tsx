/**
 * Gift a box: to an address, or as a claim link. Illustrations of the two flows, not live forms; the app wires
 * them to the contract. Accent spent once here: the link's claim marker.
 */
import { SplitHeading } from "@/components/motion/SmoothScroll";
import { Logo } from "@/components/Logo";

export function Gift() {
  return (
    <section id="gift" aria-labelledby="gift-title" className="border-t border-line py-28 md:py-36">
      <div className="wrap">
        <div className="grid gap-8 md:grid-cols-2 md:items-end">
          <div>
            <p className="label" data-reveal>
              Gift a box
            </p>
            <SplitHeading as="h2" id="gift-title" onScroll className="h-section mt-5" lines={["Send a box.", "They open it."]} />
          </div>
          <p className="lede max-w-[28em] md:justify-self-end" data-reveal>
            Buy a box for someone else. The pack stays sealed until they open it, and the stocks land in their wallet,
            not yours.
          </p>
        </div>

        <div className="mt-16 grid gap-4 md:grid-cols-2">
          <article className="flex flex-col rounded-[18px] border border-line bg-panel p-6 md:p-8" data-reveal>
            <h3 className="h-card">To an address</h3>
            <p className="mt-3 max-w-[30em] text-[15px] leading-relaxed text-muted">
              Paste a wallet on Arc. The box is theirs the moment the play settles.
            </p>
            <div className="mt-auto pt-10">
              <span className="label">Recipient</span>
              <div className="money mt-3 flex min-h-[48px] items-center break-all rounded-[10px] border border-line-strong bg-panel-2 px-4 py-3 text-[15px] text-cream">
                0x4F2a91c03b7E5d18A6f0c9D3e2B7a1145cE0d9A3
              </div>
              <div className="mt-4 flex items-center justify-between text-[14px]">
                <span className="text-muted">1 box</span>
                <span className="money text-cream">1.00 USDC</span>
              </div>
            </div>
          </article>

          <article className="flex flex-col rounded-[18px] border border-line bg-panel p-6 md:p-8" data-reveal>
            <h3 className="h-card">As a link</h3>
            <p className="mt-3 max-w-[30em] text-[15px] leading-relaxed text-muted">
              Send a claim link in any chat. Whoever opens it first claims the box, and nobody can jump the claim.
            </p>
            <div className="mt-auto pt-10">
              <span className="label">Claim link</span>
              <div className="mt-3 overflow-hidden rounded-[10px] border border-line-strong bg-panel-2">
                <div className="flex items-center gap-4 border-b border-line p-4">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-[10px] border border-line bg-panel">
                    <Logo variant="mark" height={26} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] text-cream">You got a sealed box</p>
                    <p className="money truncate text-[13px] text-muted">arclaw.app/claim/7Hq2xV9c</p>
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-3 text-[14px]">
                  <span className="text-muted">Opens into 3 cards</span>
                  <span className="label !text-claw">Claim</span>
                </div>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
