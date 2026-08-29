import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthSessionProvider } from "@/components/session-provider";
import { LegacyCacheCleanup } from "@/components/legacy-cache-cleanup";
import { CrestDefs } from "@/components/team-crest";
import { GoalXNavigation } from "@/components/goalx-navigation";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { DEFAULT_LOCALE, LOCALE_DIR, isLocale } from "@/lib/i18n/translations";
import {
  DISPLAY_MODE_COOKIE,
  DESKTOP_VIEWPORT_WIDTH,
  MOBILE_VIEWPORT_WIDTH,
  isDisplayMode,
  type DisplayMode,
} from "@/lib/display-mode";
import { DisplayModeProvider } from "@/lib/display-mode-context";
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

// The one place the viewport's real width is decided - reads the same
// display-mode cookie the root layout reads for the initial DisplayMode
// value, so the <meta name="viewport"> tag lands correctly-sized in the
// very first server-rendered HTML (no client-side tag mutation, no flash
// of the wrong layout). "desktop" pins the browser to a desktop-width
// viewport with no initialScale, so it auto-zooms the whole page out to
// fit the physical screen exactly like a mobile browser's own "Request
// Desktop Site" - never a fixed-width wrapper, which would just clip and
// force horizontal scrolling instead of reflowing the page.
export async function generateViewport(): Promise<Viewport> {
  const cookieStore = await cookies();
  const cookieMode = cookieStore.get(DISPLAY_MODE_COOKIE)?.value;
  const mode: DisplayMode = isDisplayMode(cookieMode) ? cookieMode : "auto";

  if (mode === "desktop") {
    return { width: DESKTOP_VIEWPORT_WIDTH };
  }
  if (mode === "mobile") {
    return { width: MOBILE_VIEWPORT_WIDTH, initialScale: 1 };
  }
  return { width: "device-width", initialScale: 1 };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("goalx-locale")?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const cookieDisplayMode = cookieStore.get(DISPLAY_MODE_COOKIE)?.value;
  const displayMode: DisplayMode = isDisplayMode(cookieDisplayMode) ? cookieDisplayMode : "auto";

  return (
    <html lang={locale} dir={LOCALE_DIR[locale]}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <CrestDefs />
        <LegacyCacheCleanup />
        <LocaleProvider initialLocale={locale}>
          <DisplayModeProvider initialDisplayMode={displayMode}>
            <AuthSessionProvider>
              <Suspense fallback={null}>
                <GoalXNavigation />
              </Suspense>
              {children}
            </AuthSessionProvider>
          </DisplayModeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
