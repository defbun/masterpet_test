import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: {
    default: "НПП Спецпромавтомат — выдув ПЭТ-тары и линии розлива",
    template: "%s — НПП Спецпромавтомат",
  },
  description:
    "Оборудование для производства (выдува) ПЭТ бутылок и линий розлива воды, пива, масла, химии и других жидкостей. Московский завод-изготовитель.",
  keywords: ["розлив", "выдув", "ПЭТ", "выдув ПЭТ", "ПЭТ бутылки", "производство", "линии розлива", "оборудование"],
  icons: {
    icon: "/favicon.ico",
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Each response gets its own CSP nonce from src/proxy.ts, so pages render per request.
  await connection();

  return (
    <html lang="ru">
      <body className="min-h-screen bg-white text-ink antialiased">
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
