import Link from "next/link";
import { Logo } from "./Logo";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#gift", label: "Gift" },
  { href: "#stocks", label: "Stocks" },
  { href: "#odds", label: "Odds" },
];

export function SiteHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-50">
      <div className="wrap flex h-20 items-center justify-between">
        <Link href="/" aria-label="arclaw home" className="rounded-[4px]">
          <Logo height={26} />
        </Link>
        <nav aria-label="Sections" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} className="rounded-[10px] px-3 py-2 text-[15px] text-muted transition-colors hover:text-cream">
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
