import { Home, Users, LayoutGrid, CalendarDays, Trophy, Landmark, Wallet, Shirt, ArrowLeftRight, Medal, type LucideIcon } from "lucide-react"
import type { TranslationKey } from "@/lib/i18n/translations"

export interface NavItem {
  key: string
  labelKey: TranslationKey
  href: string
  icon: LucideIcon
  isActive: (pathname: string, tab: string | null) => boolean
}

// The single source of truth for the game's main navigation - both the
// desktop top bar and the mobile bottom bar (GoalXNavigation) render off
// this list, so adding a screen here is the only place it needs to be added.
// "tactics" is a tab of /squad (see squad-tactics-app.tsx), not its own
// route - it's listed separately here only so it gets its own nav entry.
export const NAV_ITEMS: NavItem[] = [
  {
    key: "home",
    labelKey: "nav.home",
    href: "/dashboard",
    icon: Home,
    isActive: (pathname) => pathname === "/dashboard",
  },
  {
    key: "squad",
    labelKey: "nav.squad",
    href: "/squad",
    icon: Users,
    isActive: (pathname, tab) => pathname === "/squad" && tab !== "tactics",
  },
  {
    key: "tactics",
    labelKey: "nav.tactics",
    href: "/squad?tab=tactics",
    icon: LayoutGrid,
    isActive: (pathname, tab) => pathname === "/squad" && tab === "tactics",
  },
  {
    key: "matches",
    labelKey: "nav.matches",
    href: "/matches",
    icon: CalendarDays,
    isActive: (pathname) => pathname.startsWith("/matches"),
  },
  {
    key: "league",
    labelKey: "nav.league",
    href: "/league",
    icon: Trophy,
    isActive: (pathname) => pathname.startsWith("/league"),
  },
  {
    key: "stadium",
    labelKey: "nav.stadium",
    href: "/stadium",
    icon: Landmark,
    isActive: (pathname) => pathname.startsWith("/stadium"),
  },
  {
    key: "economy",
    labelKey: "nav.economy",
    href: "/economy",
    icon: Wallet,
    isActive: (pathname) => pathname.startsWith("/economy"),
  },
  {
    key: "club",
    labelKey: "nav.club",
    href: "/club",
    icon: Shirt,
    isActive: (pathname) => pathname.startsWith("/club"),
  },
  {
    key: "hallOfFame",
    labelKey: "nav.hallOfFame",
    href: "/hall-of-fame",
    icon: Medal,
    isActive: (pathname) => pathname.startsWith("/hall-of-fame"),
  },
  {
    key: "transfers",
    labelKey: "nav.transfers",
    href: "/transfers",
    icon: ArrowLeftRight,
    isActive: (pathname) => pathname.startsWith("/transfers"),
  },
]

// On mobile these four get a direct bottom-bar slot; everything else sits
// behind "More" so the bar never has to cram in every screen at once.
//
// "matches" takes the slot "tactics" used to hold: Tactics is already one
// tap away as a tab inside /squad (see squad-tactics-app.tsx's own
// Squad/Tactics/Youth switcher) and remains in the More menu, so nothing
// lost access - while the match calendar is a top-level destination with no
// other route into it.
const MOBILE_PRIMARY_KEYS = new Set(["home", "squad", "matches", "league"])
export const MOBILE_PRIMARY_ITEMS = NAV_ITEMS.filter((item) => MOBILE_PRIMARY_KEYS.has(item.key))
export const MOBILE_OVERFLOW_ITEMS = NAV_ITEMS.filter((item) => !MOBILE_PRIMARY_KEYS.has(item.key))

// Pre-game screens (auth/onboarding) - the nav only ever appears once the
// user is actually inside the game.
const NAV_HIDDEN_ROUTES = new Set(["/", "/signin", "/signup", "/forgot-password", "/reset-password"])

export function isNavHiddenRoute(pathname: string): boolean {
  return NAV_HIDDEN_ROUTES.has(pathname)
}
