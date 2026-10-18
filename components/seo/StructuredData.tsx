type JsonLd = Record<string, unknown>;

/** Render JSON-LD in the initial HTML so crawlers do not need client JavaScript to discover it. */
export function StructuredData({ data }: { data: JsonLd }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
