import type { Metadata } from "next";
import Breadcrumbs from "@/components/Breadcrumbs";
import ContactCTA from "@/components/ContactCTA";

export const metadata: Metadata = { title: "Фотогалерея", description: "Фотогалерея оборудования НПП Спецпромавтомат." };

export default function PhotoPage() {
  const photos = Array.from({ length: 12 }, (_, i) => `/company/photo/ready/${String(i + 1).padStart(4, "0")}.jpg`);
  return (
    <>
      <section className="border-b border-line bg-surface">
        <div className="container-x py-8 md:py-12">
          <Breadcrumbs crumbs={[{ t: "Главная", h: "/" }]} current="Фотогалерея" />
          <h1 className="mt-4 text-[28px] font-bold tracking-tight md:text-[40px]">Фотогалерея</h1>
        </div>
      </section>
      <div className="container-x mt-10 grid grid-cols-2 gap-4 md:grid-cols-3">
        {photos.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt={`Фото оборудования ${i + 1}`} loading="lazy" className="aspect-[4/3] w-full rounded-2xl border border-line bg-white object-contain" />
        ))}
      </div>
      <ContactCTA />
    </>
  );
}
