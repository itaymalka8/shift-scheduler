import Image from "next/image"
import Link from "next/link"
import { cookies } from "next/headers"
import { Button } from "@/components/ui/button"
import { LanguageSwitcher } from "@/components/language-switcher"
import { DEFAULT_LOCALE, getTranslator, isLocale } from "@/lib/i18n/translations"

export default async function Home() {
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get("goalx-locale")?.value
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const t = getTranslator(locale)

  return (
    <div className="goalx-hero-gradient min-h-screen flex flex-col items-center justify-center px-6 py-10 text-white">
      <div className="w-full max-w-2xl flex justify-end mb-4">
        <LanguageSwitcher variant="dark" />
      </div>

      <div className="flex flex-col items-center text-center max-w-2xl">
        <Image
          src="/logo.png"
          alt="Goalx Manager"
          width={140}
          height={140}
          className="animate-goalx-float rounded-full shadow-2xl"
          priority
        />

        <h1 className="mt-8 text-4xl md:text-6xl font-bold tracking-tight">
          {t("app.name")}
        </h1>
        <p className="mt-4 text-lg md:text-xl text-white/80">{t("landing.tagline")}</p>

        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <Button asChild size="lg" className="text-base px-8">
            <Link href="/signup">{t("landing.ctaSignup")}</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="text-base px-8 border-white/30 bg-white/5 text-white hover:bg-white/15 hover:text-white"
          >
            <Link href="/signin">{t("landing.ctaSignin")}</Link>
          </Button>
        </div>
      </div>

      <div className="mt-20 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl w-full">
        <FeatureCard title={t("landing.feature1Title")} description={t("landing.feature1Desc")} />
        <FeatureCard title={t("landing.feature2Title")} description={t("landing.feature2Desc")} />
        <FeatureCard title={t("landing.feature3Title")} description={t("landing.feature3Desc")} />
      </div>
    </div>
  )
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/5 backdrop-blur-sm p-6 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-white/70">{description}</p>
    </div>
  )
}
