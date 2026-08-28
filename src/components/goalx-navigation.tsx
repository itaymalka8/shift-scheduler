"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useState } from "react"
import { MoreHorizontal } from "lucide-react"
import { useT } from "@/lib/i18n/locale-context"
import { NAV_ITEMS, MOBILE_PRIMARY_ITEMS, MOBILE_OVERFLOW_ITEMS, isNavHiddenRoute, type NavItem } from "@/lib/navigation"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

/**
 * The one navigation surface for every screen inside the game - a sticky top
 * bar on wide viewports, a fixed bottom bar (plus a "more" sheet for the
 * overflow) on narrow ones. Renders nothing on pre-game routes (auth,
 * onboarding) - see isNavHiddenRoute.
 */
export function GoalXNavigation() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = searchParams.get("tab")
  const t = useT()
  const [moreOpen, setMoreOpen] = useState(false)

  if (isNavHiddenRoute(pathname)) return null

  const activeItem = NAV_ITEMS.find((item) => item.isActive(pathname, tab))
  const overflowActive = MOBILE_OVERFLOW_ITEMS.some((item) => item === activeItem)

  return (
    <>
      {/* Desktop / tablet: sticky top bar */}
      <header data-testid="goalx-nav-desktop" className="sticky top-0 z-40 hidden border-b bg-card md:block">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 lg:px-6">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
            <Image src="/logo.png" alt="GoalX Manager" width={30} height={30} className="rounded-full" />
            <span className="hidden text-sm font-semibold lg:inline">{t("app.name")}</span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <DesktopNavLink key={item.key} item={item} active={item === activeItem} label={t(item.labelKey)} />
            ))}
          </nav>
        </div>
      </header>

      {/* Mobile: fixed bottom bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label={t("app.name")}
      >
        <div className="grid grid-cols-5">
          {MOBILE_PRIMARY_ITEMS.map((item) => (
            <MobileNavLink key={item.key} item={item} active={item === activeItem} label={t(item.labelKey)} />
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2 text-xs",
              overflowActive ? "text-primary" : "text-muted-foreground"
            )}
            aria-current={overflowActive ? "page" : undefined}
          >
            <MoreHorizontal className="size-5" />
            {t("nav.more")}
          </button>
        </div>
      </nav>

      {/* Spacer so page content never sits under the fixed mobile bar */}
      <div className="h-16 md:hidden" style={{ height: "calc(4rem + env(safe-area-inset-bottom))" }} aria-hidden="true" />

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="md:hidden">
          <SheetTitle className="px-4 pt-4">{t("nav.more")}</SheetTitle>
          {/* 2 columns fits the current overflow set (stadium, economy)
              cleanly - revisit if more screens land here later. */}
          <div className="grid grid-cols-2 gap-3 p-4 pt-2">
            {MOBILE_OVERFLOW_ITEMS.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-colors",
                  item === activeItem
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-transparent text-muted-foreground hover:bg-muted"
                )}
              >
                <item.icon className="size-5" />
                {t(item.labelKey)}
              </Link>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function DesktopNavLink({ item, active, label }: { item: NavItem; active: boolean; label: string }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <item.icon className="size-4" />
      {label}
    </Link>
  )
}

function MobileNavLink({ item, active, label }: { item: NavItem; active: boolean; label: string }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn("flex flex-col items-center gap-0.5 py-2 text-xs", active ? "text-primary" : "text-muted-foreground")}
    >
      <item.icon className="size-5" />
      {label}
    </Link>
  )
}
