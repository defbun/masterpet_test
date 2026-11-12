import type { Metadata } from "next";
import Link from "next/link";
import Breadcrumbs from "@/components/Breadcrumbs";
import ContactCTA from "@/components/ContactCTA";
import { PHONES } from "@/lib/site";

export const metadata: Metadata = {
  title: "Современная техника (хиты продаж)",
  description: "Современная техника: моноблоки газированной воды, автоматы, XRB-16 из нержавеющей стали, розлив молочных продуктов с любым пенообразованием.",
};

const HITS = [
  { t: "Розлив молочных продуктов (автомат)", d: "с любым пенообразованием в т.ч. неоднородных" },
  { t: "МР1-XRB16 (нерж. сталь)", d: "розлив газ. воды с дозатором сиропа" },
  { t: "Моноблок розлив-укупор газ. воды", d: "автомат" },
  { t: "Автоматы розлива на 3000 литров/час", d: "газ. вода" },
  { t: "Автомат укупор на 5.0 бутылки", d: "" },
  { t: "Автомат укупор на масляную пробку", d: "" },
  { t: "Любые растворители", d: "автоматические линии" },
  { t: "Сильнопенящиеся жидкости с пеноотсекателями", d: "автоматы и полуавтоматы розлива" },
];

export default function ModernPage() {
  return (
    <>
      <section className="border-b border-line bg-surface">
        <div className="container-x py-8 md:py-12">
          <Breadcrumbs crumbs={[{ t: "Главная", h: "/" }]} current="Современная техника" />
          <h1 className="mt-4 text-[28px] font-bold tracking-tight md:text-[40px]">Современная техника</h1>
          <p className="mt-3 text-[16px] text-ink-soft">Хиты продаж</p>
        </div>
      </section>
      <div className="container-x mt-10">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {HITS.map((h) => (
            <div key={h.t} className="rounded-2xl border border-line bg-white p-6">
              <h2 className="text-[17px] font-bold leading-snug">{h.t}</h2>
              {h.d && <p className="mt-2 text-[14.5px] text-ink-soft">({h.d})</p>}
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-col gap-4 rounded-3xl bg-brand-soft p-8 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xl font-bold">Готовые линии со склада в Москве</p>
            <p className="mt-1 text-ink-soft">
              Звоните сейчас! {PHONES[0].label} (круглосуточно), {PHONES[1].label} (офис)
            </p>
          </div>
          <Link href="/bottling/" className="btn btn-primary">
            Линии розлива
          </Link>
        </div>
      </div>
      <ContactCTA />
    </>
  );
}
