import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthSessionProvider } from "@/components/session-provider";
import { SessionGuard } from "@/components/session-guard";
import { CrestDefs } from "@/components/team-crest";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { DEFAULT_LOCALE, LOCALE_DIR, isLocale } from "@/lib/i18n/translations";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("goalx-locale")?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  return (
    <html lang={locale} dir={LOCALE_DIR[locale]}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <CrestDefs />
        <LocaleProvider initialLocale={locale}>
          <AuthSessionProvider>
            <SessionGuard />
            {children}
          </AuthSessionProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
