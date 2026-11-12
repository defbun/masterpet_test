import type { Metadata } from "next";
import Breadcrumbs from "@/components/Breadcrumbs";
import ContactCTA from "@/components/ContactCTA";

export const metadata: Metadata = {
  title: "Почему покупают у нас",
  description: "Коллектив наладчиков, дизайн-студия, техническая поддержка, сервисная служба и специалисты производства НПП Спецпромавтомат.",
};

const BLOCKS = [
  { t: "Коллектив наладчиков", i: ["Монтаж", "Пуско-наладка", "Обучение персонала", "Линия «под ключ»"] },
  { t: "Собственная дизайн-студия", i: ["Выбор объема тары", "Чертежи", "Выбор формы бутылки"] },
  { t: "Служба технической поддержки", i: ["Выбор техники", "Технологии розлива", "Особенности разных линий", "Тонкости эксплуатации"] },
  { t: "Сервисная служба", i: ["Предпроектная планировка", "План подвода коммуникаций", "Обеспечение расходниками", "Обеспечение запчастями", "Гарантийный ремонт"] },
  {
    t: "Специалисты производства",
    i: [
      "Участок заготовок и сварочных работ",
      "Электромонтажный участок",
      "Первый слесарно-сборочный",
      "Второй слесарно-сборочный",
      "Третий слесарно-сборочный",
      "Четвертый слесарно-сборочный",
      "Пятый слесарно-сборочный",
      "Инженеры конструкторского бюро (КБ)",
      "Инспектора службы технического контроля (СТК)",
      "Специалисты отдела снабжения",
    ],
  },
  {
    t: "А также другие службы",
    i: ["Отдел кадров", "Бухгалтерия", "Секретариат", "IT-специалисты", "Отдел маркетинга и продаж", "Транспортно-экспедиторская служба", "Специалисты АХО, другие сотрудники"],
  },
];

export default function WhyUsPage() {
  return (
    <>
      <section className="border-b border-line bg-surface">
        <div className="container-x py-8 md:py-12">
          <Breadcrumbs crumbs={[{ t: "Главная", h: "/" }]} current="Почему покупают у нас" />
          <h1 className="mt-4 text-[28px] font-bold tracking-tight md:text-[40px]">Почему покупают у нас</h1>
          <p className="mt-3 max-w-2xl text-[16px] text-ink-soft">Почти бесплатно для вас работают:</p>
        </div>
      </section>
      <div className="container-x mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {BLOCKS.map((b) => (
          <div key={b.t} className="rounded-3xl border border-line bg-white p-7">
            <h2 className="text-xl font-bold tracking-tight">{b.t}</h2>
            <ul className="mt-4 space-y-2 text-[15px] text-ink-soft">
              {b.i.map((x) => (
                <li key={x} className="flex gap-3">
                  <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  {x}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <ContactCTA />
    </>
  );
}
