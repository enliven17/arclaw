/** Last call to play, then the footer. The accent is spent once here, on the button. */
import { Logo } from "@/components/Logo";
import { SplitHeading } from "@/components/motion/SmoothScroll";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="wrap py-28 md:py-36">
        <div className="flex flex-col items-start gap-10 md:flex-row md:items-end md:justify-between">
          <SplitHeading as="h2" onScroll className="h-display" lines={["One dollar.", "Three stocks."]} />
          <a href="#main" className="btn" data-reveal>
            Play for <span className="money">1 USDC</span>
          </a>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="wrap flex flex-col gap-8 py-10 md:flex-row md:items-center md:justify-between">
          <Logo height={22} />
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-muted">
              <li>
                <a className="transition-colors hover:text-cream" href="#how">
                  How it works
                </a>
              </li>
              <li>
                <a className="transition-colors hover:text-cream" href="#gift">
                  Gift a box
                </a>
              </li>
              <li>
                <a className="transition-colors hover:text-cream" href="#odds">
                  Odds
                </a>
              </li>
              <li>
                <a className="transition-colors hover:text-cream" href="https://explorer.arc.io" rel="noopener noreferrer" target="_blank">
                  Arc explorer
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <div className="wrap pb-10">
          <p className="max-w-[60em] text-[13px] leading-relaxed text-muted">
            Built on Arc. Stocks are Astock tokens held in your wallet. Prizes are tokenized stocks and can lose value.
            Nothing here is investment advice.
          </p>
        </div>
      </div>
    </footer>
  );
}
