"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useT } from "@/lib/i18n/locale-context"
import type { TranslationKey } from "@/lib/i18n/translations"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  FORMATION_IDS,
  CUSTOM_FORMATION_ID,
  CUSTOM_FORMATION_ZONES,
  GOALKEEPER_SLOT,
  CUSTOM_MIN_X,
  CUSTOM_MAX_X,
  CUSTOM_OUTFIELD_MIN_Y,
  CUSTOM_OUTFIELD_MAX_Y,
  deriveRoleFromPosition,
  resolveFormationSlots,
  type FormationSlot,
} from "@/lib/players/formations"
import { POSITION_GROUP, type PlayerPosition } from "@/lib/players/positions"
import { calculatePositionSuitability, type PositionFit } from "@/lib/players/suitability"
import { getPlayerTier, getFitnessLevel, getDisplayStatus, type PlayerStatus, type DisplayPlayerStatus } from "@/lib/players/tiers"
import { getPlayerVisualGrade, PLAYER_VISUAL_GRADE_CONFIG } from "@/lib/players/visual-grade"
import { formatMarketValue, formatMarketValueCompact } from "@/lib/players/currency"
import {
  MENTALITY_OPTIONS,
  PRESSING_OPTIONS,
  TEMPO_OPTIONS,
  WIDTH_OPTIONS,
  ATTACKING_STYLE_OPTIONS,
  DEFENSIVE_LINE_OPTIONS,
  CREATIVE_FREEDOM_OPTIONS,
  DRIBBLE_FREQUENCY_OPTIONS,
  PASSING_TYPE_OPTIONS,
  ATTACK_DIRECTION_OPTIONS,
  FULLBACK_OVERLAP_OPTIONS,
} from "@/lib/players/tactics"
import type { TacticalAssessment } from "@/lib/match/engine/coach-advice"
import { JerseyPreview } from "@/components/kit/jersey-preview"
import type { KitColors } from "@/lib/kits/defaults"
import { getReadableTextColor } from "@/lib/kits/contrast"
import {
  ATTRIBUTE_CATEGORIES,
  GOALKEEPER_ATTRIBUTE_CATEGORIES,
  getAttributeScoreTier,
  attributeLabelKey,
  type AttributeKey,
  type PlayerAttributes,
} from "@/lib/players/attributes"
import { calculatePositionOverall } from "@/lib/players/overall"

interface PlayerDTO {
  id: string
  firstName: string
  lastName: string
  primaryPosition: string
  secondaryPositions: string[]
  age: number
  overall: number
  potential: number
  fitness: number
  status: PlayerStatus
  marketValue: number
  weeklySalary: number
  preferredFoot: "left" | "right" | "both"
  nationality: string
  shirtNumber: number
  attributes: PlayerAttributes
}

interface Assignment {
  slotIndex: number
  playerId: string
}

interface Point {
  x: number
  y: number
}

type SortKey = "ability" | "position" | "age" | "fitness"

const POSITION_ORDER: PlayerPosition[] = ["GK", "CB", "RB", "LB", "CDM", "CM", "CAM", "RM", "LM", "RW", "LW", "ST"]

// One Tailwind treatment per tier's cardStyle token (see config.ts's
// PLAYER_TIERS) - the config stays framework-agnostic, only this map knows
// what "premium" or "prestige" actually look like.
const TIER_CARD_CLASSES: Record<string, string> = {
  "plain-gray": "bg-card border-border",
  "gray-outline": "bg-card border-muted-foreground/30",
  "clean-light": "bg-card border-border",
  "purple-subtle": "bg-card border-primary/30",
  "purple-rich": "bg-primary/5 border-primary/50",
  premium: "bg-gradient-to-br from-primary/10 to-amber-500/10 border-primary/60 shadow-sm",
  prestige: "bg-gradient-to-br from-primary/15 via-amber-400/10 to-primary/15 border-amber-500/70 shadow-md",
}

const TIER_BADGE_CLASSES: Record<string, string> = {
  "plain-gray": "bg-muted text-muted-foreground",
  "gray-outline": "bg-muted text-muted-foreground",
  "clean-light": "bg-primary/10 text-primary",
  "purple-subtle": "bg-primary/10 text-primary",
  "purple-rich": "bg-primary/15 text-primary",
  premium: "bg-primary text-primary-foreground",
  prestige: "bg-gradient-to-r from-amber-500 to-primary text-white",
}

// Small dot color per fitness level (see tiers.ts's getFitnessLevel) - used
// as the tiny fitness indicator on a pitch mini card, never a number.
const FITNESS_DOT_CLASSES: Record<string, string> = {
  excellent: "bg-emerald-500",
  good: "bg-lime-500",
  average: "bg-amber-500",
  low: "bg-red-500",
}

const FIT_BADGE_CLASSES: Record<string, string> = {
  excellent: "bg-emerald-100 text-emerald-800",
  good: "bg-primary/10 text-primary",
  average: "bg-amber-100 text-amber-800",
  weak: "bg-red-100 text-red-800",
}

// Same status colors PlayerCard already uses (starting/injured/suspended get
// their own color, everything else - bench/unavailable - is neutral) - kept
// as its own constant rather than reused from PlayerCard so that component
// (used by the untouched Squad tab) stays exactly as it was.
const SQUAD_ROW_STATUS_CLASSES: Record<DisplayPlayerStatus, string> = {
  starting: "bg-emerald-100 text-emerald-800",
  bench: "bg-muted text-muted-foreground",
  available: "bg-muted text-muted-foreground",
  injured: "bg-red-100 text-red-800",
  suspended: "bg-amber-100 text-amber-800",
  unavailable: "bg-muted text-muted-foreground",
}

type SquadPositionFilter = "ALL" | "GK" | "DF" | "MF" | "FW"

const SQUAD_POSITION_FILTERS: { key: SquadPositionFilter; labelKey: TranslationKey }[] = [
  { key: "ALL", labelKey: "squad.filter.all" },
  { key: "GK", labelKey: "squad.filter.gk" },
  { key: "DF", labelKey: "squad.filter.df" },
  { key: "MF", labelKey: "squad.filter.mf" },
  { key: "FW", labelKey: "squad.filter.fw" },
]

type SquadSortKey = "overall" | "position" | "age" | "fitness"

// A sensible starting layout for a manager entering the custom builder for
// the first time - a plain 4-4-2 shape, already legal within the custom
// zones, that they can then drag away from.
const DEFAULT_CUSTOM_SLOTS: Point[] = [
  { x: 82, y: 25 },
  { x: 62, y: 22 },
  { x: 38, y: 22 },
  { x: 18, y: 25 },
  { x: 82, y: 55 },
  { x: 60, y: 52 },
  { x: 40, y: 52 },
  { x: 18, y: 55 },
  { x: 62, y: 82 },
  { x: 38, y: 82 },
]

function fullName(p: PlayerDTO): string {
  return `${p.firstName} ${p.lastName}`
}

/** What a mini pitch card actually has room for - last name only (see PitchPlayerCard). */
function shortName(p: PlayerDTO): string {
  return p.lastName || p.firstName
}

function positionLabelKey(position: string): TranslationKey {
  return `squad.position.${position}` as TranslationKey
}

async function patchSquad(body: Record<string, unknown>) {
  const res = await fetch("/api/squad", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) return null
  return (await res.json()) as {
    formation: string
    customFormation: Point[] | null
    assignments: Assignment[]
    mentality: string | null
    tempo: string | null
    pressing: string | null
    width: string | null
    attackingStyle: string | null
    defensiveLine: string | null
    offsideTrap: boolean
    creativeFreedom: string | null
    dribbleFrequency: string | null
    passingType: string | null
    attackDirection: string | null
    fullbackOverlaps: string | null
    captainId: string | null
    penaltyTakerId: string | null
    freeKickTakerId: string | null
    cornerTakerId: string | null
  }
}

async function fetchAssessment(): Promise<TacticalAssessment | null> {
  const res = await fetch("/api/squad/assessment")
  if (!res.ok) return null
  return (await res.json()) as TacticalAssessment
}

export function SquadTacticsApp({
  players,
  initialAssignments,
  initialFormation,
  initialCustomFormation,
  initialMentality,
  initialTempo,
  initialPressing,
  initialWidth,
  initialAttackingStyle,
  initialDefensiveLine,
  initialOffsideTrap,
  initialCreativeFreedom,
  initialDribbleFrequency,
  initialPassingType,
  initialAttackDirection,
  initialFullbackOverlaps,
  initialCaptainId,
  initialPenaltyTakerId,
  initialFreeKickTakerId,
  initialCornerTakerId,
  accentColor,
  homeKit,
  teamTotalQuality,
  squadMarketValue,
  totalWeeklyPlayerSalaries,
}: {
  players: PlayerDTO[]
  initialAssignments: Assignment[]
  initialFormation: string
  initialCustomFormation: Point[] | null
  initialMentality: string
  initialTempo: string
  initialPressing: string
  initialWidth: string
  initialAttackingStyle: string
  initialDefensiveLine: string
  initialOffsideTrap: boolean
  initialCreativeFreedom: string
  initialDribbleFrequency: string
  initialPassingType: string
  initialAttackDirection: string
  initialFullbackOverlaps: string
  initialCaptainId: string | null
  initialPenaltyTakerId: string | null
  initialFreeKickTakerId: string | null
  initialCornerTakerId: string | null
  accentColor: string
  homeKit: KitColors
  teamTotalQuality: number
  squadMarketValue: number
  totalWeeklyPlayerSalaries: number
}) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])

  // The URL is the single source of truth for which tab is showing (not
  // local state) - that's what lets the shared nav bar's "Tactics" link
  // actually land on the tactics tab: a click there only ever changes the
  // URL, and if the tab were separate component state, this already-mounted
  // instance would never learn about it (a prop change alone doesn't reset
  // useState after the first render). It's also what makes a refresh and a
  // direct link to /squad?tab=tactics land correctly.
  const tab: "squad" | "tactics" = searchParams.get("tab") === "tactics" ? "tactics" : "squad"

  const setTab = (next: "squad" | "tactics") => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === "tactics") params.set("tab", "tactics")
    else params.delete("tab")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }
  const [sortKey, setSortKey] = useState<SortKey>("ability")
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null)

  const [formation, setFormation] = useState(initialFormation)
  const [customFormation, setCustomFormation] = useState<Point[] | null>(initialCustomFormation)
  const [assignments, setAssignments] = useState<Map<number, string>>(
    () => new Map(initialAssignments.map((a) => [a.slotIndex, a.playerId]))
  )
  const [mentality, setMentality] = useState(initialMentality)
  const [tempo, setTempo] = useState(initialTempo)
  const [pressing, setPressing] = useState(initialPressing)
  const [width, setWidth] = useState(initialWidth)
  const [attackingStyle, setAttackingStyle] = useState(initialAttackingStyle)
  const [defensiveLine, setDefensiveLine] = useState(initialDefensiveLine)
  const [offsideTrap, setOffsideTrap] = useState(initialOffsideTrap)
  const [creativeFreedom, setCreativeFreedom] = useState(initialCreativeFreedom)
  const [dribbleFrequency, setDribbleFrequency] = useState(initialDribbleFrequency)
  const [passingType, setPassingType] = useState(initialPassingType)
  const [attackDirection, setAttackDirection] = useState(initialAttackDirection)
  const [fullbackOverlaps, setFullbackOverlaps] = useState(initialFullbackOverlaps)
  const [captainId, setCaptainId] = useState(initialCaptainId)
  const [penaltyTakerId, setPenaltyTakerId] = useState(initialPenaltyTakerId)
  const [freeKickTakerId, setFreeKickTakerId] = useState(initialFreeKickTakerId)
  const [cornerTakerId, setCornerTakerId] = useState(initialCornerTakerId)

  const [assessment, setAssessment] = useState<TacticalAssessment | null>(null)

  const [pickerSlotIndex, setPickerSlotIndex] = useState<number | null>(null)
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null)
  const [squadSheetOpen, setSquadSheetOpen] = useState(false)
  const [confirmRecommend, setConfirmRecommend] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle")
  const savedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const slots = useMemo(() => resolveFormationSlots(formation, customFormation), [formation, customFormation])

  const startingIds = useMemo(() => new Set(assignments.values()), [assignments])
  const benchPlayers = players.filter((p) => !startingIds.has(p.id))

  async function refreshAssessment() {
    setAssessment(await fetchAssessment())
  }

  useEffect(() => {
    if (tab === "tactics" && !assessment) refreshAssessment()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  function flashSaved() {
    setSaveStatus("saved")
    if (savedTimeout.current) clearTimeout(savedTimeout.current)
    savedTimeout.current = setTimeout(() => setSaveStatus("idle"), 1800)
  }

  async function applyAndSave(body: Record<string, unknown>, optimistic: () => void) {
    optimistic()
    const result = await patchSquad(body)
    if (result) {
      setFormation(result.formation)
      setCustomFormation(result.customFormation)
      setAssignments(new Map(result.assignments.map((a) => [a.slotIndex, a.playerId])))
      setMentality(result.mentality ?? "balanced")
      setTempo(result.tempo ?? "normal")
      setPressing(result.pressing ?? "normal")
      setWidth(result.width ?? "balanced")
      setAttackingStyle(result.attackingStyle ?? "shortPassing")
      setDefensiveLine(result.defensiveLine ?? "normal")
      setOffsideTrap(result.offsideTrap)
      setCreativeFreedom(result.creativeFreedom ?? "balanced")
      setDribbleFrequency(result.dribbleFrequency ?? "balanced")
      setPassingType(result.passingType ?? "mixed")
      setAttackDirection(result.attackDirection ?? "balanced")
      setFullbackOverlaps(result.fullbackOverlaps ?? "normal")
      setCaptainId(result.captainId)
      setPenaltyTakerId(result.penaltyTakerId)
      setFreeKickTakerId(result.freeKickTakerId)
      setCornerTakerId(result.cornerTakerId)
      flashSaved()
      refreshAssessment()
    }
  }

  function assignPlayer(slotIndex: number, playerId: string | null) {
    applyAndSave({ assignments: [{ slotIndex, playerId }] }, () => {
      setAssignments((prev) => {
        const next = new Map(prev)
        for (const [idx, pid] of next) {
          if (pid === playerId) next.delete(idx)
        }
        if (playerId) next.set(slotIndex, playerId)
        else next.delete(slotIndex)
        return next
      })
    })
    setPickerSlotIndex(null)
  }

  function changeFormation(next: string) {
    setSelectedSlotIndex(null)
    if (next === CUSTOM_FORMATION_ID) {
      const seed = customFormation ?? DEFAULT_CUSTOM_SLOTS
      applyAndSave({ formation: next, customFormation: seed }, () => {
        setFormation(next)
        setCustomFormation(seed)
      })
    } else {
      applyAndSave({ formation: next }, () => setFormation(next))
    }
  }

  function saveCustomFormation(next: Point[]) {
    applyAndSave({ formation: CUSTOM_FORMATION_ID, customFormation: next }, () => setCustomFormation(next))
  }

  async function applyRecommended() {
    const res = await fetch("/api/squad/recommend", { method: "POST" })
    if (res.ok) {
      const body = (await res.json()) as { formation: string; assignments: Assignment[] }
      setSelectedSlotIndex(null)
      setFormation(body.formation)
      setAssignments(new Map(body.assignments.map((a) => [a.slotIndex, a.playerId])))
      flashSaved()
      refreshAssessment()
    }
    setConfirmRecommend(false)
  }

  function resetTactics() {
    const body = {
      mentality: "balanced",
      tempo: "normal",
      pressing: "normal",
      width: "balanced",
      attackingStyle: "shortPassing",
      defensiveLine: "normal",
      offsideTrap: false,
      creativeFreedom: "balanced",
      dribbleFrequency: "balanced",
      passingType: "mixed",
      attackDirection: "balanced",
      fullbackOverlaps: "normal",
    }
    applyAndSave(body, () => {
      setMentality(body.mentality)
      setTempo(body.tempo)
      setPressing(body.pressing)
      setWidth(body.width)
      setAttackingStyle(body.attackingStyle)
      setDefensiveLine(body.defensiveLine)
      setOffsideTrap(body.offsideTrap)
      setCreativeFreedom(body.creativeFreedom)
      setDribbleFrequency(body.dribbleFrequency)
      setPassingType(body.passingType)
      setAttackDirection(body.attackDirection)
      setFullbackOverlaps(body.fullbackOverlaps)
    })
  }

  function handleDrop(slotIndex: number, e: React.DragEvent) {
    e.preventDefault()
    const playerId = e.dataTransfer.getData("text/plain")
    if (playerId) assignPlayer(slotIndex, playerId)
  }

  function handleDropOnBench(e: React.DragEvent) {
    e.preventDefault()
    const playerId = e.dataTransfer.getData("text/plain")
    for (const [idx, pid] of assignments) {
      if (pid === playerId) {
        assignPlayer(idx, null)
        return
      }
    }
  }

  const sortedSquad = useMemo(() => {
    const arr = [...players]
    arr.sort((a, b) => {
      if (sortKey === "ability") return b.overall - a.overall
      if (sortKey === "age") return a.age - b.age
      if (sortKey === "fitness") return b.fitness - a.fitness
      return (
        POSITION_ORDER.indexOf(a.primaryPosition as PlayerPosition) -
        POSITION_ORDER.indexOf(b.primaryPosition as PlayerPosition)
      )
    })
    return arr
  }, [players, sortKey])

  const expandedPlayer = expandedPlayerId ? byId.get(expandedPlayerId) ?? null : null

  return (
    // pb-24 clears the fixed mobile bottom nav bar (GoalXNavigation) - its
    // own layout-level spacer only adds space above the page's content, not
    // after it, so without this the last ~55px of whatever this page
    // renders last is permanently covered once scrolled to the bottom.
    // Desktop has no fixed bottom bar, hence md:pb-0.
    <div className="pb-24 md:pb-0">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("squad.title")}</h1>
        <span
          className={cn(
            "text-sm text-muted-foreground transition-opacity",
            saveStatus === "saved" ? "opacity-100" : "opacity-0"
          )}
        >
          {t("squad.saved")}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 rounded-lg border bg-card p-3 text-center sm:grid-cols-4 sm:gap-4">
        <div>
          <div className="text-lg font-bold text-primary">{teamTotalQuality}</div>
          <div className="text-xs text-muted-foreground">{t("squad.summaryQuality")}</div>
        </div>
        <div>
          <div className="text-lg font-bold text-primary">{formatMarketValueCompact(squadMarketValue)}</div>
          <div className="text-xs text-muted-foreground">{t("squad.summaryValue")}</div>
        </div>
        <div>
          <div className="text-lg font-bold text-primary">{formatMarketValueCompact(totalWeeklyPlayerSalaries)}</div>
          <div className="text-xs text-muted-foreground">{t("squad.summarySalaries")}</div>
        </div>
        <div>
          <div className="text-lg font-bold text-primary">{players.length}</div>
          <div className="text-xs text-muted-foreground">{t("squad.summaryPlayers")}</div>
        </div>
      </div>

      <div className="mb-6 flex gap-2 border-b">
        <button
          type="button"
          onClick={() => setTab("squad")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px",
            tab === "squad" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
          )}
        >
          {t("squad.tabSquad")}
        </button>
        <button
          type="button"
          onClick={() => setTab("tactics")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px",
            tab === "tactics" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
          )}
        >
          {t("squad.tabTactics")}
        </button>
      </div>

      {tab === "squad" ? (
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("squad.sortBy")}</span>
            {(["ability", "position", "age", "fitness"] as SortKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortKey(key)}
                className={cn(
                  "rounded-full border px-3 py-1",
                  sortKey === key ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"
                )}
              >
                {t(`squad.sort${key[0].toUpperCase()}${key.slice(1)}` as TranslationKey)}
              </button>
            ))}
          </div>

          <ul className="space-y-2">
            {sortedSquad.map((player) => (
              <li key={player.id}>
                <PlayerCard
                  player={player}
                  status={getDisplayStatus(player.status, startingIds.has(player.id))}
                  onClick={() => setExpandedPlayerId(player.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        // Three grid items in this exact order (not two) so mobile - which
        // simply stacks grid children top to bottom with no explicit
        // template-columns below lg - reads as Pitch+bench, then the
        // (now compact) tactics panel, then formation/fit/squad-list. On
        // lg+, the tactics panel lands beside the pitch (row 1, col 2) and
        // the formation/fit/squad-list block continues below the pitch
        // (row 2, col 1), leaving the tactics column narrow instead of a
        // full-height sidebar.
        <div className="grid gap-6 lg:grid-cols-[1fr_328px] lg:items-start">
          <div className="space-y-4">
            {formation === CUSTOM_FORMATION_ID && (
              <CustomFormationBuilder
                slots={customFormation ?? DEFAULT_CUSTOM_SLOTS}
                onCommit={saveCustomFormation}
                accentColor={accentColor}
              />
            )}

            <Pitch
              slots={slots}
              assignments={assignments}
              byId={byId}
              onDrop={handleDrop}
              selectedSlotIndex={selectedSlotIndex}
              onSelectSlot={setSelectedSlotIndex}
              onOpenPicker={(slotIndex) => setPickerSlotIndex(slotIndex)}
              homeKit={homeKit}
            />

            {selectedSlotIndex !== null &&
              (() => {
                const playerId = assignments.get(selectedSlotIndex)
                const player = playerId ? byId.get(playerId) : undefined
                if (!player) return null
                const slotRole = slots[selectedSlotIndex].role
                const fit = fitOf(player, slotRole)
                const fitScore = fit !== "natural" ? calculatePositionOverall(player.attributes, slotRole) : null

                return (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-2 shadow-sm sm:gap-3 sm:p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs font-semibold sm:text-sm">
                        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-primary">{player.overall}</span>
                        <span className="truncate">{fullName(player)}</span>
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground sm:text-xs">
                        {t(positionLabelKey(player.primaryPosition))}
                        {fitScore !== null && (
                          <span className="ms-2 text-amber-700">
                            {t("squad.action.outOfPosition")} · {t("squad.action.fitScore", { score: String(fitScore) })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 sm:gap-2">
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs sm:h-8 sm:px-3 sm:text-sm" onClick={() => setExpandedPlayerId(player.id)}>
                        {t("squad.action.viewProfile")}
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs sm:h-8 sm:px-3 sm:text-sm" onClick={() => setPickerSlotIndex(selectedSlotIndex)}>
                        {t("squad.action.swap")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs sm:h-8 sm:px-3 sm:text-sm"
                        onClick={() => {
                          assignPlayer(selectedSlotIndex, null)
                          setSelectedSlotIndex(null)
                        }}
                      >
                        {t("squad.action.removeFromLineup")}
                      </Button>
                    </div>
                  </div>
                )
              })()}

            <div onDragOver={(e) => e.preventDefault()} onDrop={handleDropOnBench}>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t("squad.bench")}</h2>
              <div className="flex flex-wrap gap-2">
                {benchPlayers.map((p) => (
                  <BenchChip key={p.id} player={p} onClick={() => setExpandedPlayerId(p.id)} />
                ))}
              </div>
            </div>
          </div>

          <div className="min-w-0 space-y-4 lg:sticky lg:top-4">
            <CompactDial
              titleKey="squad.mentality.title"
              value={mentality}
              options={MENTALITY_OPTIONS as readonly string[]}
              prefix="squad.mentality"
              onChange={(v) => applyAndSave({ mentality: v }, () => setMentality(v))}
            />
            <CompactDial
              titleKey="squad.attackingStyle.title"
              value={attackingStyle}
              options={ATTACKING_STYLE_OPTIONS as readonly string[]}
              prefix="squad.attackingStyle"
              onChange={(v) => applyAndSave({ attackingStyle: v }, () => setAttackingStyle(v))}
            />
            <CompactDial
              titleKey="squad.tempo.title"
              value={tempo}
              options={TEMPO_OPTIONS as readonly string[]}
              prefix="squad.tempo"
              onChange={(v) => applyAndSave({ tempo: v }, () => setTempo(v))}
            />
            <CompactDial
              titleKey="squad.pressing.title"
              value={pressing}
              options={PRESSING_OPTIONS as readonly string[]}
              prefix="squad.pressing"
              onChange={(v) => applyAndSave({ pressing: v }, () => setPressing(v))}
            />
            <CompactDial
              titleKey="squad.defensiveLine.title"
              value={defensiveLine}
              options={DEFENSIVE_LINE_OPTIONS as readonly string[]}
              prefix="squad.defensiveLine"
              onChange={(v) => applyAndSave({ defensiveLine: v }, () => setDefensiveLine(v))}
            />

            <CollapsibleSection title={t("squad.tactics.moreSettings")}>
              <CompactDial
                titleKey="squad.width.title"
                value={width}
                options={WIDTH_OPTIONS as readonly string[]}
                prefix="squad.width"
                onChange={(v) => applyAndSave({ width: v }, () => setWidth(v))}
              />
              <CompactDial
                titleKey="squad.creativeFreedom.title"
                value={creativeFreedom}
                options={CREATIVE_FREEDOM_OPTIONS as readonly string[]}
                prefix="squad.creativeFreedom"
                onChange={(v) => applyAndSave({ creativeFreedom: v }, () => setCreativeFreedom(v))}
              />
              <CompactDial
                titleKey="squad.dribbleFrequency.title"
                value={dribbleFrequency}
                options={DRIBBLE_FREQUENCY_OPTIONS as readonly string[]}
                prefix="squad.dribbleFrequency"
                onChange={(v) => applyAndSave({ dribbleFrequency: v }, () => setDribbleFrequency(v))}
              />
              <CompactDial
                titleKey="squad.passingType.title"
                value={passingType}
                options={PASSING_TYPE_OPTIONS as readonly string[]}
                prefix="squad.passingType"
                onChange={(v) => applyAndSave({ passingType: v }, () => setPassingType(v))}
              />
              <CompactDial
                titleKey="squad.attackDirection.title"
                value={attackDirection}
                options={ATTACK_DIRECTION_OPTIONS as readonly string[]}
                prefix="squad.attackDirection"
                onChange={(v) => applyAndSave({ attackDirection: v }, () => setAttackDirection(v))}
              />
              <CompactDial
                titleKey="squad.fullbackOverlaps.title"
                value={fullbackOverlaps}
                options={FULLBACK_OVERLAP_OPTIONS as readonly string[]}
                prefix="squad.fullbackOverlaps"
                onChange={(v) => applyAndSave({ fullbackOverlaps: v }, () => setFullbackOverlaps(v))}
              />
              <CompactToggle
                titleKey="squad.offsideTrap.title"
                descKey="squad.offsideTrap.desc"
                value={offsideTrap}
                onChange={(v) => applyAndSave({ offsideTrap: v }, () => setOffsideTrap(v))}
              />
            </CollapsibleSection>

            <CollapsibleSection title={t("squad.tactics.keyRoles")}>
              <RoleSelect
                label={t("squad.captain")}
                players={players}
                value={captainId}
                onChange={(v) => applyAndSave({ captainId: v }, () => setCaptainId(v))}
              />
              <RoleSelect
                label={t("squad.penaltyTaker")}
                players={players}
                value={penaltyTakerId}
                onChange={(v) => applyAndSave({ penaltyTakerId: v }, () => setPenaltyTakerId(v))}
              />
              <RoleSelect
                label={t("squad.freeKickTaker")}
                players={players}
                value={freeKickTakerId}
                onChange={(v) => applyAndSave({ freeKickTakerId: v }, () => setFreeKickTakerId(v))}
              />
              <RoleSelect
                label={t("squad.cornerTaker")}
                players={players}
                value={cornerTakerId}
                onChange={(v) => applyAndSave({ cornerTakerId: v }, () => setCornerTakerId(v))}
              />
            </CollapsibleSection>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <span className="font-medium">{t("squad.formation")}</span>
                <select
                  className="rounded-md border bg-background px-2 py-1 text-sm"
                  value={formation}
                  onChange={(e) => changeFormation(e.target.value)}
                >
                  {FORMATION_IDS.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                  <option value={CUSTOM_FORMATION_ID}>{t("squad.formation.custom")}</option>
                </select>
              </label>
              <Button size="sm" variant="outline" onClick={() => setConfirmRecommend(true)}>
                {t("squad.recommendedXI")}
              </Button>
              <Button size="sm" variant="ghost" onClick={resetTactics}>
                {t("squad.resetTactics")}
              </Button>
            </div>

            <TacticalFitPanel assessment={assessment} />

            {/* The full 22-player squad isn't shown open by default here -
                the Squad tab already exists for that. This just opens the
                same SquadList in a panel (side drawer on desktop, bottom
                sheet on mobile) so the tactics screen itself stays about
                lineup/bench/formation/instructions. */}
            <Button variant="outline" className="w-full" onClick={() => setSquadSheetOpen(true)}>
              {t("squad.openFullSquad")}
            </Button>
          </div>
        </div>
      )}

      {/* Full squad panel - opened on demand from the button above. Reuses
          SquadList exactly as the Squad tab does; selecting a player here
          just opens the same read-only detail dialog as everywhere else. */}
      <Sheet open={squadSheetOpen} onOpenChange={setSquadSheetOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-2xl lg:inset-y-0 lg:inset-x-auto lg:top-0 lg:right-0 lg:left-auto lg:bottom-auto lg:h-full lg:max-h-none lg:w-full lg:max-w-md lg:rounded-none lg:border-t-0 lg:border-l lg:data-[state=open]:slide-in-from-right lg:data-[state=closed]:slide-out-to-right"
        >
          <SheetHeader>
            <SheetTitle>{t("squad.tabSquad")}</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">
            <SquadList
              players={players}
              startingIds={startingIds}
              onSelect={(playerId) => {
                setSquadSheetOpen(false)
                setExpandedPlayerId(playerId)
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* expanded player modal / full profile */}
      <Dialog open={!!expandedPlayer} onOpenChange={(open) => !open && setExpandedPlayerId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          {expandedPlayer && (
            <>
              <DialogHeader>
                <DialogTitle>
                  #{expandedPlayer.shirtNumber} {fullName(expandedPlayer)}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <Row label={t("squad.colAbility")} value={String(expandedPlayer.overall)} />
                {(() => {
                  const slotEntry = [...assignments.entries()].find(([, playerId]) => playerId === expandedPlayer.id)
                  if (!slotEntry) return null
                  const role = slots[slotEntry[0]].role
                  if (role === (expandedPlayer.primaryPosition as PlayerPosition)) return null
                  return (
                    <Row
                      label={t("squad.currentPositionOverall")}
                      value={String(calculatePositionOverall(expandedPlayer.attributes, role))}
                    />
                  )
                })()}
                <Row label={t("squad.colPotential")} value={String(expandedPlayer.potential)} />
                <Row label={t("squad.sortPosition")} value={t(positionLabelKey(expandedPlayer.primaryPosition))} />
                {expandedPlayer.secondaryPositions.length > 0 && (
                  <Row
                    label={t("squad.secondaryPositionsList")}
                    value={expandedPlayer.secondaryPositions.map((p) => t(positionLabelKey(p))).join(", ")}
                  />
                )}
                <Row label={t("squad.colAge")} value={String(expandedPlayer.age)} />
                <Row
                  label={t("squad.colFitness")}
                  value={t(`squad.fitness.${getFitnessLevel(expandedPlayer.fitness)}` as TranslationKey)}
                />
                <Row
                  label={t("squad.status.starting")}
                  value={t(
                    `squad.status.${getDisplayStatus(expandedPlayer.status, startingIds.has(expandedPlayer.id))}` as TranslationKey
                  )}
                />
                <Row label={t("squad.colMarketValue")} value={formatMarketValue(expandedPlayer.marketValue)} />
                <Row
                  label={t("squad.colWeeklySalary")}
                  value={`${formatMarketValue(expandedPlayer.weeklySalary)} ${t("economy.perWeek")}`}
                />
                <Row label={t("squad.colFoot")} value={t(`squad.foot.${expandedPlayer.preferredFoot}` as TranslationKey)} />
              </div>

              <AttributeCategories player={expandedPlayer} />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* pick a player for a slot (click-to-assign, mobile-friendly alternative to drag) */}
      <Dialog open={pickerSlotIndex !== null} onOpenChange={(open) => !open && setPickerSlotIndex(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("squad.pickPlayerTitle")}</DialogTitle>
          </DialogHeader>
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {pickerSlotIndex !== null &&
              benchPlayers
                .slice()
                .sort((a, b) => {
                  const slotRole = slots[pickerSlotIndex].role
                  const fitScore = (p: PlayerDTO) => {
                    const fit = fitOf(p, slotRole)
                    return fit === "natural" ? 2 : fit === "secondary" ? 1 : 0
                  }
                  return fitScore(b) - fitScore(a) || b.overall - a.overall
                })
                .map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => assignPlayer(pickerSlotIndex, p.id)}
                      className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent"
                    >
                      <span>
                        #{p.shirtNumber} {fullName(p)}
                      </span>
                      <span className="text-muted-foreground">
                        {t(positionLabelKey(p.primaryPosition))} · {p.overall}
                      </span>
                    </button>
                  </li>
                ))}
          </ul>
        </DialogContent>
      </Dialog>

      {/* recommended XI confirmation */}
      <Dialog open={confirmRecommend} onOpenChange={setConfirmRecommend}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("squad.recommendedXI")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("squad.recommendedConfirm")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRecommend(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={applyRecommended}>{t("common.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function fitOf(player: PlayerDTO, position: PlayerPosition): PositionFit {
  return calculatePositionSuitability(player, position)
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b py-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function AttributeBar({ attrKey, value }: { attrKey: AttributeKey; value: number }) {
  const t = useT()
  const tier = getAttributeScoreTier(value)
  return (
    <div className="flex items-center gap-2 py-1 text-sm">
      <span className="w-28 shrink-0 text-muted-foreground sm:w-36">{t(attributeLabelKey(attrKey) as TranslationKey)}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tier.colorClass)} style={{ width: `${value}%` }} />
      </div>
      <span className="w-6 shrink-0 text-end font-medium">{value}</span>
    </div>
  )
}

/** Full categorized attribute breakdown - the "profile" a player card opens into. */
function AttributeCategories({ player }: { player: PlayerDTO }) {
  const t = useT()
  const isGoalkeeper = player.primaryPosition === "GK"
  const categories = isGoalkeeper ? GOALKEEPER_ATTRIBUTE_CATEGORIES : ATTRIBUTE_CATEGORIES

  return (
    <div className="mt-4 space-y-4 border-t pt-4">
      {categories.map((category) => (
        <div key={category.id}>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t(category.labelKey as TranslationKey)}
          </h3>
          {category.keys.map((key) => {
            const value = player.attributes[key as AttributeKey]
            if (value == null) return null
            return <AttributeBar key={key} attrKey={key as AttributeKey} value={value} />
          })}
        </div>
      ))}
    </div>
  )
}

function PlayerCard({
  player,
  status,
  onClick,
  compact,
  draggable,
}: {
  player: PlayerDTO
  status: DisplayPlayerStatus
  onClick: () => void
  compact?: boolean
  draggable?: boolean
}) {
  const t = useT()
  const tier = getPlayerTier(player.overall)
  const statusColor =
    status === "starting"
      ? "bg-emerald-100 text-emerald-800"
      : status === "injured"
        ? "bg-red-100 text-red-800"
        : status === "suspended"
          ? "bg-amber-100 text-amber-800"
          : status === "unavailable"
            ? "bg-muted text-muted-foreground"
            : "bg-muted text-muted-foreground"

  return (
    <button
      type="button"
      onClick={onClick}
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", player.id)}
      className={cn(
        "flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border px-3 text-start hover:brightness-[0.98]",
        TIER_CARD_CLASSES[tier.cardStyle],
        compact ? "py-1.5" : "py-2.5"
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="w-6 shrink-0 text-center text-xs text-muted-foreground">#{player.shirtNumber}</span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{fullName(player)}</div>
          <div className="truncate text-xs text-muted-foreground">
            {t(positionLabelKey(player.primaryPosition))} · {t("squad.colAge")} {player.age}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {t(`squad.fitness.${getFitnessLevel(player.fitness)}` as TranslationKey)}
        </span>
        <span className={cn("rounded-md px-2 py-0.5 text-sm font-bold", TIER_BADGE_CLASSES[tier.cardStyle])}>
          {player.overall}
        </span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusColor)}>
          {t(`squad.status.${status}` as TranslationKey)}
        </span>
      </div>
    </button>
  )
}

function BenchChip({ player, onClick }: { player: PlayerDTO; onClick: () => void }) {
  const t = useT()
  const tier = getPlayerTier(player.overall)
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", player.id)}
      onClick={onClick}
      className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs hover:brightness-[0.98]", TIER_CARD_CLASSES[tier.cardStyle])}
      title={fullName(player)}
    >
      <span className="text-muted-foreground">#{player.shirtNumber}</span>
      <span className="font-medium">{fullName(player)}</span>
      <span className="text-muted-foreground">{t(positionLabelKey(player.primaryPosition))}</span>
      <span className="font-bold text-primary">{player.overall}</span>
    </button>
  )
}

/**
 * The full squad, as a compact scannable list under the pitch - one row per
 * player instead of the old attribute-heavy PlayerCard. Filtering, search
 * and sort all run in memory over the already-loaded `players` prop (no
 * extra fetches). Clicking a row only opens the existing full-detail dialog
 * (via onSelect/expandedPlayerId in the parent) - it never touches the
 * lineup itself.
 */
function SquadList({
  players,
  startingIds,
  onSelect,
}: {
  players: PlayerDTO[]
  startingIds: Set<string>
  onSelect: (playerId: string) => void
}) {
  const t = useT()
  const [query, setQuery] = useState("")
  const [positionFilter, setPositionFilter] = useState<SquadPositionFilter>("ALL")
  const [sortKey, setSortKey] = useState<SquadSortKey>("overall")

  const visiblePlayers = useMemo(() => {
    let arr = players
    if (positionFilter !== "ALL") {
      arr = arr.filter((p) => POSITION_GROUP[p.primaryPosition as PlayerPosition] === positionFilter)
    }
    const q = query.trim().toLowerCase()
    if (q) arr = arr.filter((p) => fullName(p).toLowerCase().includes(q))

    const sorted = [...arr]
    sorted.sort((a, b) => {
      if (sortKey === "overall") return b.overall - a.overall
      if (sortKey === "age") return a.age - b.age
      if (sortKey === "fitness") return b.fitness - a.fitness
      return (
        POSITION_ORDER.indexOf(a.primaryPosition as PlayerPosition) -
        POSITION_ORDER.indexOf(b.primaryPosition as PlayerPosition)
      )
    })
    return sorted
  }, [players, positionFilter, query, sortKey])

  return (
    <div className="space-y-1.5">
      <h2 className="text-sm font-medium text-muted-foreground">{t("squad.tabSquad")}</h2>

      {/* One flex-wrap toolbar for chips + search + sort - on a wide enough
          screen (desktop) it all fits on a single line; on mobile it wraps
          exactly like two separate rows would, so nothing is lost there. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <PositionFilter value={positionFilter} onChange={setPositionFilter} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("squad.searchPlaceholder")}
          className="min-w-0 flex-1 rounded-md border bg-background px-2.5 py-1 text-sm"
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SquadSortKey)}
          className="shrink-0 rounded-md border bg-background px-1.5 py-1 text-xs"
          aria-label={t("squad.sortBy")}
        >
          <option value="overall">{t("squad.sortAbility")}</option>
          <option value="position">{t("squad.sortPosition")}</option>
          <option value="age">{t("squad.sortAge")}</option>
          <option value="fitness">{t("squad.sortFitness")}</option>
        </select>
      </div>

      {visiblePlayers.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("squad.noPlayersFound")}</p>
      ) : (
        <ul className="space-y-1">
          {visiblePlayers.map((player) => (
            <li key={player.id}>
              <PlayerSquadRow
                player={player}
                status={getDisplayStatus(player.status, startingIds.has(player.id))}
                onClick={() => onSelect(player.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Segmented position-group chips (All / GK / DF / MF / FW) filtering SquadList. */
function PositionFilter({
  value,
  onChange,
}: {
  value: SquadPositionFilter
  onChange: (value: SquadPositionFilter) => void
}) {
  const t = useT()
  return (
    <div className="flex flex-wrap gap-1.5">
      {SQUAD_POSITION_FILTERS.map((f) => (
        <button
          key={f.key}
          type="button"
          onClick={() => onChange(f.key)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
            value === f.key ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
          )}
        >
          {t(f.labelKey)}
        </button>
      ))}
    </div>
  )
}

/**
 * One player, one compact row: Overall (tier-colored, most prominent) →
 * name → position/fitness → status badge. Two lines on mobile (name; then
 * position + fitness, age dropped as secondary), a single line at sm+.
 * Reuses the existing tier/fitness color systems verbatim - no new colors.
 */
function PlayerSquadRow({
  player,
  status,
  onClick,
}: {
  player: PlayerDTO
  status: DisplayPlayerStatus
  onClick: () => void
}) {
  const t = useT()
  const tier = getPlayerTier(player.overall)
  const fitnessLevel = getFitnessLevel(player.fitness)

  return (
    <button
      type="button"
      onClick={onClick}
      title={fullName(player)}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-start transition-colors hover:brightness-[0.98] sm:gap-3",
        TIER_CARD_CLASSES[tier.cardStyle]
      )}
    >
      <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-sm font-extrabold sm:px-2", TIER_BADGE_CLASSES[tier.cardStyle])}>
        {player.overall}
      </span>

      <span className="min-w-0 flex-1 truncate text-sm font-medium">{fullName(player)}</span>

      {/* Position always shows (capped width, truncates on the rare very-long
          label) - age is secondary and only appears once there's room, at sm+. */}
      <span className="max-w-[5.5rem] shrink-0 truncate text-xs text-muted-foreground">
        {t(positionLabelKey(player.primaryPosition))}
      </span>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        {t("squad.colAge")} {player.age}
      </span>

      {/* Fitness: a dot always, the word itself only once there's room (sm+) - never a wide progress bar. */}
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", FITNESS_DOT_CLASSES[fitnessLevel])} />
        <span className="hidden sm:inline">{t(`squad.fitness.${fitnessLevel}` as TranslationKey)}</span>
      </span>

      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium sm:text-xs", SQUAD_ROW_STATUS_CLASSES[status])}>
        {t(`squad.status.${status}` as TranslationKey)}
      </span>
    </button>
  )
}

// Real pitch proportions in meters, rendered portrait (own goal at the top,
// attacking goal at the bottom) - the container's aspect-ratio is set to
// match exactly, so the SVG markings below land at true-to-life positions
// instead of being derived from an arbitrary "2/3" box.
const PITCH_W = 68
const PITCH_H = 105
const LINE_W = 0.45
const PENALTY_BOX_W = 40.32
const PENALTY_BOX_D = 16.5
const SIX_YARD_W = 18.32
const SIX_YARD_D = 5.5
const PENALTY_SPOT_Y = 11
const CENTER_CIRCLE_R = 9.15
const GOAL_W = 7.32

// Where the D-arc (the part of the penalty-arc circle that lies outside the
// box) meets the box's front edge - solved once here from the real
// dimensions above, reused for both ends by mirroring y.
const D_ARC_HALF_CHORD = Math.sqrt(CENTER_CIRCLE_R ** 2 - (PENALTY_BOX_D - PENALTY_SPOT_Y) ** 2)
const D_ARC_X0 = PITCH_W / 2 - D_ARC_HALF_CHORD
const D_ARC_X1 = PITCH_W / 2 + D_ARC_HALF_CHORD

/** The real line markings only - no fill, no tactical zone bands, drawn once in true proportion and mirrored top/bottom. */
function PitchMarkings() {
  const boxX = (PITCH_W - PENALTY_BOX_W) / 2
  const sixYardX = (PITCH_W - SIX_YARD_W) / 2
  const goalX = (PITCH_W - GOAL_W) / 2
  const cx = PITCH_W / 2

  return (
    <svg
      viewBox={`0 0 ${PITCH_W} ${PITCH_H}`}
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      preserveAspectRatio="xMidYMid meet"
    >
      <g fill="none" stroke="white" strokeOpacity={0.92} strokeWidth={LINE_W}>
        <rect x={LINE_W / 2} y={LINE_W / 2} width={PITCH_W - LINE_W} height={PITCH_H - LINE_W} />
        <line x1={0} y1={PITCH_H / 2} x2={PITCH_W} y2={PITCH_H / 2} />
        <circle cx={cx} cy={PITCH_H / 2} r={CENTER_CIRCLE_R} />

        {/* Top (own) penalty area */}
        <rect x={boxX} y={0} width={PENALTY_BOX_W} height={PENALTY_BOX_D} />
        <rect x={sixYardX} y={0} width={SIX_YARD_W} height={SIX_YARD_D} />
        <path d={`M ${D_ARC_X0} ${PENALTY_BOX_D} A ${CENTER_CIRCLE_R} ${CENTER_CIRCLE_R} 0 0 0 ${D_ARC_X1} ${PENALTY_BOX_D}`} />
        <path d={`M ${goalX} 0 L ${goalX} ${-2} L ${goalX + GOAL_W} ${-2} L ${goalX + GOAL_W} 0`} />

        {/* Bottom (attacking) penalty area */}
        <rect x={boxX} y={PITCH_H - PENALTY_BOX_D} width={PENALTY_BOX_W} height={PENALTY_BOX_D} />
        <rect x={sixYardX} y={PITCH_H - SIX_YARD_D} width={SIX_YARD_W} height={SIX_YARD_D} />
        <path
          d={`M ${D_ARC_X0} ${PITCH_H - PENALTY_BOX_D} A ${CENTER_CIRCLE_R} ${CENTER_CIRCLE_R} 0 0 1 ${D_ARC_X1} ${PITCH_H - PENALTY_BOX_D}`}
        />
        <path d={`M ${goalX} ${PITCH_H} L ${goalX} ${PITCH_H + 2} L ${goalX + GOAL_W} ${PITCH_H + 2} L ${goalX + GOAL_W} ${PITCH_H}`} />

        {/* Corner arcs */}
        <path d={`M 0 1 A 1 1 0 0 0 1 0`} />
        <path d={`M ${PITCH_W - 1} 0 A 1 1 0 0 0 ${PITCH_W} 1`} />
        <path d={`M ${PITCH_W} ${PITCH_H - 1} A 1 1 0 0 0 ${PITCH_W - 1} ${PITCH_H}`} />
        <path d={`M 1 ${PITCH_H} A 1 1 0 0 0 0 ${PITCH_H - 1}`} />
      </g>
      <circle cx={cx} cy={PITCH_H / 2} r={0.45} fill="white" />
      <circle cx={cx} cy={PENALTY_SPOT_Y} r={0.45} fill="white" />
      <circle cx={cx} cy={PITCH_H - PENALTY_SPOT_Y} r={0.45} fill="white" />
    </svg>
  )
}

/**
 * A player as they appear on the pitch - Overall is the dominant number
 * (never the shirt number), name and position underneath, tier styling
 * reused verbatim from the existing PLAYER_TIERS system (TIER_CARD_CLASSES/
 * TIER_BADGE_CLASSES - the same classes PlayerCard uses in the squad list),
 * and only a small dot for fitness/fit warnings - never a colorful card-game
 * treatment, and never a permanently-visible remove control.
 */
function PitchPlayerCard({
  player,
  slotRole,
  fit,
  selected,
  onClick,
  draggable,
  homeKit,
}: {
  player: PlayerDTO
  slotRole: PlayerPosition
  fit: PositionFit
  selected: boolean
  onClick: () => void
  draggable?: boolean
  homeKit: KitColors
}) {
  const t = useT()
  const fitnessLevel = getFitnessLevel(player.fitness)
  // A purely cosmetic read of Overall (see visual-grade.ts) - separate from
  // the 7-step getPlayerTier system PlayerCard/BenchChip/PlayerSquadRow
  // still use unchanged. Frames the card; never touches the jersey colors.
  const grade = getPlayerVisualGrade(player.overall)
  const gradeStyle = PLAYER_VISUAL_GRADE_CONFIG[grade]
  // Whatever reads on top of this specific kit's primary color - the same
  // three colors every card on the pitch shares, so this is cheap to
  // recompute per card and never needs its own query or state.
  const kitTextColor = getReadableTextColor(homeKit.primaryColor)
  const kitTextBacking = kitTextColor === "#FFFFFF" ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.8)"

  return (
    <button
      type="button"
      onClick={onClick}
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", player.id)}
      title={
        fit === "unsuitable"
          ? t("squad.positionWarning", {
              playerPosition: t(positionLabelKey(player.primaryPosition)),
              slotPosition: t(positionLabelKey(slotRole)),
            })
          : undefined
      }
      className={cn(
        "relative flex w-[2.875rem] flex-col items-center overflow-hidden rounded-lg px-0.5 py-0.5 transition-transform sm:w-[4.5rem] sm:rounded-xl sm:px-1 sm:py-1.5",
        gradeStyle.cardBorder,
        gradeStyle.cardBackground,
        gradeStyle.cardShadow,
        selected ? "ring-1 ring-primary ring-offset-1" : "hover:scale-[1.04]"
      )}
    >
      {/* The club's own home kit - the same JerseyPreview /club uses, same
          TeamKit data loaded once for the whole pitch (see Pitch/
          SquadTacticsApp) - no crest or number at this scale, both of
          JerseyPreview's optional props are simply omitted here rather
          than building a separate small component. */}
      <JerseyPreview
        template={homeKit.template}
        primaryColor={homeKit.primaryColor}
        secondaryColor={homeKit.secondaryColor}
        accentColor={homeKit.accentColor}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {fit === "unsuitable" && (
        <span className="absolute -end-1 -top-1 z-10 size-2 rounded-full border border-white bg-red-500 sm:size-3" />
      )}
      {fit === "secondary" && (
        <span className="absolute -end-1 -top-1 z-10 size-2 rounded-full border border-white bg-orange-500 sm:size-3" />
      )}
      <span
        className={cn(
          "relative z-10 rounded px-1 py-0.5 text-xs font-extrabold leading-none sm:px-1.5 sm:text-lg",
          gradeStyle.badge
        )}
      >
        {player.overall}
      </span>
      <span
        className="relative z-10 mt-0.5 max-w-full truncate rounded px-0.5 text-[9px] font-semibold leading-tight sm:mt-1 sm:text-xs"
        style={{ backgroundColor: kitTextBacking, color: kitTextColor }}
      >
        {shortName(player)}
      </span>
      <span
        className="relative z-10 mt-px flex items-center gap-1 rounded px-0.5 text-[8px] sm:text-[10px]"
        style={{ backgroundColor: kitTextBacking, color: kitTextColor }}
      >
        <span className={cn("size-1 rounded-full sm:size-1.5", FITNESS_DOT_CLASSES[fitnessLevel])} />
        {t(positionLabelKey(player.primaryPosition))}
      </span>
    </button>
  )
}

function Pitch({
  slots,
  assignments,
  byId,
  onDrop,
  selectedSlotIndex,
  onSelectSlot,
  onOpenPicker,
  homeKit,
}: {
  slots: FormationSlot[]
  assignments: Map<number, string>
  byId: Map<string, PlayerDTO>
  onDrop: (slotIndex: number, e: React.DragEvent) => void
  selectedSlotIndex: number | null
  onSelectSlot: (slotIndex: number | null) => void
  onOpenPicker: (slotIndex: number) => void
  homeKit: KitColors
}) {
  const t = useT()
  return (
    <div
      className="relative mx-auto w-full max-w-2xl select-none overflow-hidden rounded-2xl shadow-lg"
      style={{
        aspectRatio: `${PITCH_W} / ${PITCH_H}`,
        background: "repeating-linear-gradient(to bottom, #2f9e44 0%, #2f9e44 6.25%, #35ab4b 6.25%, #35ab4b 12.5%)",
      }}
    >
      <PitchMarkings />

      {slots.map((slot, slotIndex) => {
        const playerId = assignments.get(slotIndex)
        const player = playerId ? byId.get(playerId) : undefined
        const fit = player ? fitOf(player, slot.role) : "natural"
        // Rendering-only nudge so the keeper reads as standing near their own
        // goal line rather than mid-box - the formation's real y (used for
        // every position/fit calculation) is untouched.
        const visualY = slot.role === "GK" ? Math.max(4, slot.y - 4) : slot.y

        return (
          <div
            key={slotIndex}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(slotIndex, e)}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${slot.x}%`, top: `${visualY}%` }}
          >
            {player ? (
              <PitchPlayerCard
                player={player}
                slotRole={slot.role}
                fit={fit}
                selected={selectedSlotIndex === slotIndex}
                draggable
                onClick={() => onSelectSlot(selectedSlotIndex === slotIndex ? null : slotIndex)}
                homeKit={homeKit}
              />
            ) : (
              <button
                type="button"
                onClick={() => onOpenPicker(slotIndex)}
                className="flex size-12 flex-col items-center justify-center rounded-full border-2 border-dashed border-white/70 bg-white/10 text-[9px] text-white/85 sm:size-14"
              >
                {t(positionLabelKey(slot.role))}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Pure geometry editor for a custom formation - a flat (non-3D) pitch so
 * pointer coordinates map directly to percentages. Only shapes WHERE the ten
 * outfield players stand; who plays each spot is still decided on the
 * regular Pitch above, which re-renders with whatever shape is saved here.
 */
function CustomFormationBuilder({
  slots,
  onCommit,
  accentColor,
}: {
  slots: Point[]
  onCommit: (next: Point[]) => void
  accentColor: string
}) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Point[]>(slots)
  const draggingIndex = useRef<number | null>(null)

  useEffect(() => setDraft(slots), [slots])

  function positionFromEvent(e: React.PointerEvent): Point {
    const rect = containerRef.current!.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    return {
      x: Math.min(CUSTOM_MAX_X, Math.max(CUSTOM_MIN_X, x)),
      y: Math.min(CUSTOM_OUTFIELD_MAX_Y, Math.max(CUSTOM_OUTFIELD_MIN_Y, y)),
    }
  }

  function handlePointerDown(index: number, e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingIndex.current = index
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const index = draggingIndex.current
    if (index === null) return
    const point = positionFromEvent(e)
    setDraft((prev) => prev.map((slot, i) => (i === index ? point : slot)))
  }

  function handlePointerUp() {
    if (draggingIndex.current === null) return
    draggingIndex.current = null
    onCommit(draft)
  }

  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <h3 className="text-sm font-semibold">{t("squad.customFormation.title")}</h3>
      <p className="text-xs text-muted-foreground">{t("squad.customFormation.hint")}</p>
      <div
        ref={containerRef}
        className="relative mx-auto w-full max-w-md touch-none select-none overflow-hidden rounded-xl"
        style={{
          aspectRatio: "2 / 3",
          background: "repeating-linear-gradient(to bottom, #2f9e44 0%, #2f9e44 10%, #37b24d 10%, #37b24d 20%)",
        }}
      >
        {CUSTOM_FORMATION_ZONES.map((zone) => (
          <div
            key={zone.id}
            className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-white/30"
            style={{ top: `${zone.minY}%` }}
          />
        ))}
        <div
          className="pointer-events-none absolute flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/80 bg-black/60 text-[10px] font-bold text-white"
          style={{ left: `${GOALKEEPER_SLOT.x}%`, top: `${GOALKEEPER_SLOT.y}%` }}
        >
          {t(positionLabelKey("GK"))}
        </div>
        {draft.map((slot, index) => (
          <div
            key={index}
            onPointerDown={(e) => handlePointerDown(index, e)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="absolute flex size-9 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full border-2 border-white/90 text-[10px] font-bold text-white shadow-md active:cursor-grabbing"
            style={{ left: `${slot.x}%`, top: `${slot.y}%`, backgroundColor: accentColor }}
          >
            {t(positionLabelKey(deriveRoleFromPosition(slot.x, slot.y)))}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * A tactics dial as a small segmented control (iOS/macOS style) - the whole
 * point of this round's redesign: same setting, same options, same per-value
 * description, just compact enough that the manager can see most of the
 * panel without scrolling. Only the active option's description is ever
 * shown - never a full legend of all the choices.
 */
function CompactDial({
  titleKey,
  value,
  options,
  prefix,
  onChange,
}: {
  titleKey: TranslationKey
  value: string
  options: readonly string[]
  prefix: string
  onChange: (value: string) => void
}) {
  const t = useT()
  return (
    <div>
      <h3 className="mb-1.5 text-sm font-semibold">{t(titleKey)}</h3>
      <div className="flex min-w-0 gap-1 rounded-lg bg-muted/60 p-1">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              "min-w-0 flex-1 rounded-md px-1.5 py-2 text-center text-sm font-medium leading-tight transition-colors",
              value === option ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(`${prefix}.${option}` as TranslationKey)}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
        {t(`${prefix}.${value}Desc` as TranslationKey)}
      </p>
    </div>
  )
}

/** Same compact treatment as CompactDial, for the one boolean tactic (offside trap). */
function CompactToggle({
  titleKey,
  descKey,
  value,
  onChange,
}: {
  titleKey: TranslationKey
  descKey: TranslationKey
  value: boolean
  onChange: (value: boolean) => void
}) {
  const t = useT()
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t(titleKey)}</h3>
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium",
            value ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"
          )}
        >
          {t(value ? "squad.offsideTrap.on" : "squad.offsideTrap.off")}
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{t(descKey)}</p>
    </div>
  )
}

/**
 * A native <details>/<summary> disclosure - zero extra state, keyboard- and
 * screen-reader-accessible for free. Used to fold away the secondary tactics
 * (everything beyond the five headline dials) and the set-piece/captain
 * roles, so the panel opens compact and the manager expands only what they
 * need.
 */
function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
        {title}
        <svg
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="space-y-4 border-t px-3 pb-3 pt-2.5">{children}</div>
    </details>
  )
}

/**
 * The one place the manager sees whether their plan actually suits their
 * players - computed server-side by the same engine logic the match itself
 * uses, never a separate client-side guess.
 */
function TacticalFitPanel({ assessment }: { assessment: TacticalAssessment | null }) {
  const t = useT()
  if (!assessment) return null

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("squad.fit.title")}</h3>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", FIT_BADGE_CLASSES[assessment.rating])}>
          {t(`squad.fit.${assessment.rating}` as TranslationKey)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(assessment.explanation.key as TranslationKey, assessment.explanation.values)}
      </p>

      {assessment.advice.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold text-muted-foreground">{t("squad.coachAdvice.title")}</h4>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {assessment.advice.map((item) => (
              <li key={item.key}>• {t(item.key as TranslationKey, item.values)}</li>
            ))}
          </ul>
        </div>
      )}

      {assessment.bestStyles[0] && (
        <div>
          <h4 className="mb-1 text-xs font-semibold text-muted-foreground">{t("squad.bestStyles.title")}</h4>
          <p className="text-xs text-muted-foreground">
            {t(`squad.attackingStyle.${assessment.bestStyles[0].style}` as TranslationKey)} ·{" "}
            {t(`squad.fit.${assessment.bestStyles[0].rating}` as TranslationKey)}
          </p>
        </div>
      )}
    </div>
  )
}

function RoleSelect({
  label,
  players,
  value,
  onChange,
}: {
  label: string
  players: PlayerDTO[]
  value: string | null
  onChange: (value: string | null) => void
}) {
  const t = useT()
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <select
        className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{t("squad.selectPlayer")}</option>
        {players.map((p) => (
          <option key={p.id} value={p.id}>
            #{p.shirtNumber} {fullName(p)}
          </option>
        ))}
      </select>
    </label>
  )
}
