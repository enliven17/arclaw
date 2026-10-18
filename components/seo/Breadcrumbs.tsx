import Link from "next/link";
import { SITE_URL } from "@/lib/seo";
import { StructuredData } from "./StructuredData";

export type BreadcrumbItem = { label: string; href: string };

export function Breadcrumbs({ items, className = "" }: { items: BreadcrumbItem[]; className?: string }) {
  const itemListElement = items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.label,
    item: new URL(item.href, SITE_URL).toString(),
  }));

  return (
    <div className={className}>
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
          {items.map((item, index) => (
            <li key={item.href} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              {index === items.length - 1 ? (
                <span aria-current="page" className="text-cream">
                  {item.label}
                </span>
              ) : (
                <Link href={item.href} className="transition-colors hover:text-cream">
                  {item.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <StructuredData
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement,
        }}
      />
    </div>
  );
}
