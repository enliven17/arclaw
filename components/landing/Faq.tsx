import Link from "next/link";
import { StructuredData } from "@/components/seo/StructuredData";

const FAQ_ITEMS = [
  {
    question: "What do I win with a play?",
    answer: "Every play gives you one sealed box. Opening the box reveals a pack of three tokenized stock cards paid to your wallet on Arc.",
  },
  {
    question: "How much does a play cost?",
    answer: "The three machines cost 1 USDC, 5 USDC, or 10 USDC per play. Each play gives one sealed box, and there is no miss.",
  },
  {
    question: "Is the claw skill-based?",
    answer: "No. The claw is the show. The arclaw smart contract decides the box contents with a verifiable random draw.",
  },
  {
    question: "Can I lose money?",
    answer: "Yes. Most boxes are worth less than their play price, tokenized stock values can fall, and you should only play with money you can afford to lose.",
  },
  {
    question: "Can I gift a sealed box?",
    answer: "Yes. You can send a box to an Arc address or create a claim link from the gifts area of the app.",
  },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="border-t border-line py-28 md:py-36">
      <div className="wrap grid gap-8 md:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] md:items-start">
        <div>
          <h2 id="faq-title" className="h-section">
            Questions, answered.
          </h2>
          <p className="lede mt-7 max-w-[30em]">
            The short version is here. Read the <Link href="/disclaimer" className="text-cream underline underline-offset-4">risk disclaimer</Link> before you play.
          </p>
        </div>
        <div className="grid gap-3">
          {FAQ_ITEMS.map((item) => (
            <details key={item.question} className="group rounded-[14px] border border-line bg-panel px-5 py-4">
              <summary className="cursor-pointer list-none pr-8 text-[17px] text-cream marker:hidden [&::-webkit-details-marker]:hidden">
                {item.question}
              </summary>
              <p className="pt-3 text-[15px] leading-relaxed text-muted">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
      <StructuredData
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ_ITEMS.map((item) => ({
            "@type": "Question",
            name: item.question,
            acceptedAnswer: { "@type": "Answer", text: item.answer },
          })),
        }}
      />
    </section>
  );
}
