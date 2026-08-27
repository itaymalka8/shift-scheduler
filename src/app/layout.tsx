import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthSessionProvider } from "@/components/session-provider";
import { CrestDefs } from "@/components/team-crest";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Goalx Manager",
  description: "משחק ניהול כדורגל מקוון - הקימו קבוצה ותתחרו נגד מנהלים אחרים",
  icons: {
    icon: "/logo.png",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <CrestDefs />
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </body>
    </html>
  );
}
