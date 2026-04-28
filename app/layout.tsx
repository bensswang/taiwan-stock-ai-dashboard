import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "台股即時新聞盤",
  description: "整合近即時報價、自選股、台指期、加權指數與近五天新聞的台股觀測平台。"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
