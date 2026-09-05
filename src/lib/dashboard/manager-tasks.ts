import {
  ClipboardList,
  HeartPulse,
  Ban,
  AlertTriangle,
  Wallet,
  Activity,
  Landmark,
  GraduationCap,
  type LucideIcon,
} from "lucide-react"
import type { TranslationKey } from "@/lib/i18n/translations"

export type ManagerTaskSeverity = "info" | "attention" | "urgent"

export interface ManagerTask {
  id: string
  icon: LucideIcon
  title: string
  description: string
  actionLabel: string
  href: string
  severity: ManagerTaskSeverity
}

/**
 * Everything getManagerTasks needs to decide what to surface - plain,
 * already-derived facts about the club (never raw Prisma rows), so this
 * stays pure and easy to unit-test/extend later (transfers, training,
 * youth, contracts, injuries from a match, etc. per the product note).
 */
export interface ManagerTasksInput {
  requiredLineupSize: number
  lineupSize: number
  /** null when there's no scheduled next fixture at all. */
  hoursUntilNextMatch: number | null
  injuredStarterName: string | null
  suspendedStarterName: string | null
  lowFitnessStarterCount: number
  /** Team.mentality (or any tactic field) is still null - the manager has never opened the tactics panel. */
  tacticsConfigured: boolean
  balance: number
  weeklyWageBill: number
  /** A StadiumConstructionJob finished within a recent window (see the dashboard page for the cutoff). */
  stadiumUpgradeRecentlyCompleted: boolean
  /** true only while THIS human manager has an OPEN YouthIntake still awaiting a decision - never true for a bot, and gone the moment it's promotedCount===3 or otherwise CLOSED. */
  youthIntakeOpen: boolean
}

type Translator = (key: TranslationKey, vars?: Record<string, string>) => string

const SEVERITY_RANK: Record<ManagerTaskSeverity, number> = { urgent: 0, attention: 1, info: 2 }

// Order among same-severity tasks - mirrors the priority the product spec
// listed (lineup readiness first, down to informational stadium news last).
const CATEGORY_ORDER = {
  lineupIncomplete: 1,
  injuredStarter: 2,
  suspendedStarter: 3,
  tacticsUndefined: 4,
  lowBudget: 5,
  lowFitness: 6,
  youthIntakeReady: 7,
  stadiumUpgradeDone: 8,
} as const

/**
 * The single place that decides what belongs in the manager's inbox - never
 * inline in JSX (see the product note). Takes only real, already-known club
 * facts and returns every applicable task sorted by urgency; the dashboard
 * itself decides how many to actually show (today: top 3). Add a new kind
 * of task here later (a transfer offer, a finished training session, a
 * youth graduate, a contract expiring) without touching the rendering.
 */
export function getManagerTasks(input: ManagerTasksInput, t: Translator): ManagerTask[] {
  const matchSoon = input.hoursUntilNextMatch !== null && input.hoursUntilNextMatch <= 72
  const matchVerySoon = input.hoursUntilNextMatch !== null && input.hoursUntilNextMatch <= 24

  const tasks: (ManagerTask & { order: number })[] = []

  if (input.lineupSize < input.requiredLineupSize) {
    tasks.push({
      id: "lineup-incomplete",
      icon: ClipboardList,
      title: t("dashboard.tasks.lineupIncomplete.title"),
      description: matchVerySoon
        ? t("dashboard.tasks.lineupIncomplete.descUrgent")
        : matchSoon
          ? t("dashboard.tasks.lineupIncomplete.descSoon")
          : t("dashboard.tasks.lineupIncomplete.descGeneral"),
      actionLabel: t("dashboard.tasks.actionTactics"),
      href: "/squad?tab=tactics",
      severity: matchVerySoon ? "urgent" : matchSoon ? "attention" : "info",
      order: CATEGORY_ORDER.lineupIncomplete,
    })
  }

  if (input.injuredStarterName) {
    tasks.push({
      id: "injured-starter",
      icon: HeartPulse,
      title: t("dashboard.tasks.injuredStarter.title"),
      description: t("dashboard.tasks.injuredStarter.desc", { name: input.injuredStarterName }),
      actionLabel: t("dashboard.tasks.actionTactics"),
      href: "/squad?tab=tactics",
      severity: matchVerySoon ? "urgent" : "attention",
      order: CATEGORY_ORDER.injuredStarter,
    })
  }

  if (input.suspendedStarterName) {
    tasks.push({
      id: "suspended-starter",
      icon: Ban,
      title: t("dashboard.tasks.suspendedStarter.title"),
      description: t("dashboard.tasks.suspendedStarter.desc", { name: input.suspendedStarterName }),
      actionLabel: t("dashboard.tasks.actionTactics"),
      href: "/squad?tab=tactics",
      severity: matchVerySoon ? "urgent" : "attention",
      order: CATEGORY_ORDER.suspendedStarter,
    })
  }

  if (matchSoon && !input.tacticsConfigured) {
    tasks.push({
      id: "tactics-undefined",
      icon: AlertTriangle,
      title: t("dashboard.tasks.tacticsUndefined.title"),
      description: t("dashboard.tasks.tacticsUndefined.desc"),
      actionLabel: t("dashboard.tasks.actionTactics"),
      href: "/squad?tab=tactics",
      severity: matchVerySoon ? "urgent" : "attention",
      order: CATEGORY_ORDER.tacticsUndefined,
    })
  }

  if (input.weeklyWageBill > 0 && input.balance < input.weeklyWageBill) {
    tasks.push({
      id: "low-budget",
      icon: Wallet,
      title: t("dashboard.tasks.lowBudget.title"),
      description: t("dashboard.tasks.lowBudget.desc"),
      actionLabel: t("dashboard.tasks.actionEconomy"),
      href: "/economy",
      severity: "urgent",
      order: CATEGORY_ORDER.lowBudget,
    })
  }

  if (input.lowFitnessStarterCount > 0) {
    tasks.push({
      id: "low-fitness",
      icon: Activity,
      title: t("dashboard.tasks.lowFitness.title"),
      description: t("dashboard.tasks.lowFitness.desc"),
      actionLabel: t("dashboard.tasks.actionTactics"),
      href: "/squad?tab=tactics",
      severity: "attention",
      order: CATEGORY_ORDER.lowFitness,
    })
  }

  if (input.youthIntakeOpen) {
    tasks.push({
      id: "youth-intake-ready",
      icon: GraduationCap,
      title: t("dashboard.tasks.youthIntakeReady.title"),
      description: t("dashboard.tasks.youthIntakeReady.desc"),
      actionLabel: t("dashboard.tasks.actionYouth"),
      href: "/squad?tab=youth",
      severity: "attention",
      order: CATEGORY_ORDER.youthIntakeReady,
    })
  }

  if (input.stadiumUpgradeRecentlyCompleted) {
    tasks.push({
      id: "stadium-upgrade-done",
      icon: Landmark,
      title: t("dashboard.tasks.stadiumUpgradeDone.title"),
      description: t("dashboard.tasks.stadiumUpgradeDone.desc"),
      actionLabel: t("dashboard.tasks.actionStadium"),
      href: "/stadium",
      severity: "info",
      order: CATEGORY_ORDER.stadiumUpgradeDone,
    })
  }

  tasks.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.order - b.order)
  return tasks.map((task): ManagerTask => {
    const { id, icon, title, description, actionLabel, href, severity } = task
    return { id, icon, title, description, actionLabel, href, severity }
  })
}
