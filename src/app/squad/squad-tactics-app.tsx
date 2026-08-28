"use client"

import { useMemo, useRef, useState } from "react"
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
import { FORMATIONS, isFormationId, type FormationId } from "@/lib/players/formations"
import type { PlayerPosition } from "@/lib/players/positions"
import { calculatePositionSuitability, type PositionFit } from "@/lib/players/suitability"
import { getPlayerTier, getFitnessLevel, getDisplayStatus, type PlayerStatus, type DisplayPlayerStatus } from "@/lib/players/tiers"
import { formatMarketValue, formatMarketValueCompact } from "@/lib/players/currency"
import { MENTALITY_OPTIONS, PRESSING_OPTIONS, TEMPO_OPTIONS, WIDTH_OPTIONS } from "@/lib/players/tactics"
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

function fullName(p: PlayerDTO): string {
  return `${p.firstName} ${p.lastName}`
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
    formation: FormationId
    assignments: Assignment[]
    mentality: string | null
    tempo: string | null
    pressing: string | null
    width: string | null
    captainId: string | null
    penaltyTakerId: string | null
    freeKickTakerId: string | null
    cornerTakerId: string | null
  }
}

export function SquadTacticsApp({
  players,
  initialAssignments,
  initialFormation,
  initialMentality,
  initialTempo,
  initialPressing,
  initialWidth,
  initialCaptainId,
  initialPenaltyTakerId,
  initialFreeKickTakerId,
  initialCornerTakerId,
  accentColor,
  teamTotalQuality,
  squadMarketValue,
  totalWeeklyPlayerSalaries,
}: {
  players: PlayerDTO[]
  initialAssignments: Assignment[]
  initialFormation: FormationId
  initialMentality: string
  initialTempo: string
  initialPressing: string
  initialWidth: string
  initialCaptainId: string | null
  initialPenaltyTakerId: string | null
  initialFreeKickTakerId: string | null
  initialCornerTakerId: string | null
  accentColor: string
  teamTotalQuality: number
  squadMarketValue: number
  totalWeeklyPlayerSalaries: number
}) {
  const t = useT()
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])

  const [tab, setTab] = useState<"squad" | "tactics">("squad")
  const [sortKey, setSortKey] = useState<SortKey>("ability")
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null)

  const [formation, setFormation] = useState<FormationId>(initialFormation)
  const [assignments, setAssignments] = useState<Map<number, string>>(
    () => new Map(initialAssignments.map((a) => [a.slotIndex, a.playerId]))
  )
  const [mentality, setMentality] = useState(initialMentality)
  const [tempo, setTempo] = useState(initialTempo)
  const [pressing, setPressing] = useState(initialPressing)
  const [width, setWidth] = useState(initialWidth)
  const [captainId, setCaptainId] = useState(initialCaptainId)
  const [penaltyTakerId, setPenaltyTakerId] = useState(initialPenaltyTakerId)
  const [freeKickTakerId, setFreeKickTakerId] = useState(initialFreeKickTakerId)
  const [cornerTakerId, setCornerTakerId] = useState(initialCornerTakerId)

  const [pickerSlotIndex, setPickerSlotIndex] = useState<number | null>(null)
  const [confirmRecommend, setConfirmRecommend] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle")
  const savedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startingIds = useMemo(() => new Set(assignments.values()), [assignments])
  const benchPlayers = players.filter((p) => !startingIds.has(p.id))

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
      setAssignments(new Map(result.assignments.map((a) => [a.slotIndex, a.playerId])))
      flashSaved()
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

  function changeFormation(next: FormationId) {
    applyAndSave({ formation: next }, () => setFormation(next))
  }

  async function applyRecommended() {
    const res = await fetch("/api/squad/recommend", { method: "POST" })
    if (res.ok) {
      const body = (await res.json()) as { formation: FormationId; assignments: Assignment[] }
      setFormation(body.formation)
      setAssignments(new Map(body.assignments.map((a) => [a.slotIndex, a.playerId])))
      flashSaved()
    }
    setConfirmRecommend(false)
  }

  function resetTactics() {
    applyAndSave({ mentality: "balanced", tempo: "normal", pressing: "normal", width: "balanced" }, () => {
      setMentality("balanced")
      setTempo("normal")
      setPressing("normal")
      setWidth("balanced")
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
    <div>
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
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <Pitch
              formation={formation}
              assignments={assignments}
              byId={byId}
              accentColor={accentColor}
              onDrop={handleDrop}
              onSlotClick={(slotIndex) => setPickerSlotIndex(slotIndex)}
              onRemove={(slotIndex) => assignPlayer(slotIndex, null)}
            />

            <div onDragOver={(e) => e.preventDefault()} onDrop={handleDropOnBench}>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t("squad.bench")}</h2>
              <div className="flex flex-wrap gap-2">
                {benchPlayers.map((p) => (
                  <BenchChip key={p.id} player={p} onClick={() => setExpandedPlayerId(p.id)} />
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <span className="font-medium">{t("squad.formation")}</span>
                <select
                  className="rounded-md border bg-background px-2 py-1 text-sm"
                  value={formation}
                  onChange={(e) => changeFormation(e.target.value as FormationId)}
                >
                  {Object.keys(FORMATIONS).map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="sm" variant="outline" onClick={() => setConfirmRecommend(true)}>
                {t("squad.recommendedXI")}
              </Button>
              <Button size="sm" variant="ghost" onClick={resetTactics}>
                {t("squad.resetTactics")}
              </Button>
            </div>

            <div className="space-y-1">
              <h2 className="text-sm font-medium text-muted-foreground">{t("squad.tabSquad")}</h2>
              <ul className="space-y-1">
                {sortedSquad.map((player) => (
                  <li key={player.id}>
                    <PlayerCard
                      compact
                      player={player}
                      status={getDisplayStatus(player.status, startingIds.has(player.id))}
                      onClick={() => setExpandedPlayerId(player.id)}
                      draggable
                    />
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="space-y-6">
            <TacticDial
              titleKey="squad.mentality.title"
              value={mentality}
              options={MENTALITY_OPTIONS as readonly string[]}
              prefix="squad.mentality"
              onChange={(v) => applyAndSave({ mentality: v }, () => setMentality(v))}
            />
            <TacticDial
              titleKey="squad.tempo.title"
              value={tempo}
              options={TEMPO_OPTIONS as readonly string[]}
              prefix="squad.tempo"
              onChange={(v) => applyAndSave({ tempo: v }, () => setTempo(v))}
            />
            <TacticDial
              titleKey="squad.pressing.title"
              value={pressing}
              options={PRESSING_OPTIONS as readonly string[]}
              prefix="squad.pressing"
              onChange={(v) => applyAndSave({ pressing: v }, () => setPressing(v))}
            />
            <TacticDial
              titleKey="squad.width.title"
              value={width}
              options={WIDTH_OPTIONS as readonly string[]}
              prefix="squad.width"
              onChange={(v) => applyAndSave({ width: v }, () => setWidth(v))}
            />

            <div className="space-y-3">
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
            </div>
          </div>
        </div>
      )}

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
                  const role = FORMATIONS[formation][slotEntry[0]].role
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
                  const slotRole = FORMATIONS[formation][pickerSlotIndex].role
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
        "flex w-full items-center justify-between gap-3 rounded-lg border px-3 text-start hover:brightness-[0.98]",
        TIER_CARD_CLASSES[tier.cardStyle],
        compact ? "py-1.5" : "py-2.5"
      )}
    >
      <div className="flex items-center gap-3">
        <span className="w-6 text-center text-xs text-muted-foreground">#{player.shirtNumber}</span>
        <div>
          <div className="text-sm font-medium">{fullName(player)}</div>
          <div className="text-xs text-muted-foreground">
            {t(positionLabelKey(player.primaryPosition))} · {t("squad.colAge")} {player.age}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
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

function Pitch({
  formation,
  assignments,
  byId,
  accentColor,
  onDrop,
  onSlotClick,
  onRemove,
}: {
  formation: FormationId
  assignments: Map<number, string>
  byId: Map<string, PlayerDTO>
  accentColor: string
  onDrop: (slotIndex: number, e: React.DragEvent) => void
  onSlotClick: (slotIndex: number) => void
  onRemove: (slotIndex: number) => void
}) {
  const t = useT()
  return (
    <div
      className="relative mx-auto w-full max-w-md select-none overflow-hidden rounded-2xl shadow-xl"
      style={{
        aspectRatio: "2 / 3",
        transform: "perspective(1100px) rotateX(10deg)",
        transformOrigin: "center bottom",
        background: "repeating-linear-gradient(to bottom, #2f9e44 0%, #2f9e44 10%, #37b24d 10%, #37b24d 20%)",
        boxShadow: "0 25px 40px -15px rgba(0,0,0,0.5)",
      }}
    >
      <div className="pointer-events-none absolute inset-3 border-2 border-white/70" />
      <div className="pointer-events-none absolute left-3 right-3 top-1/2 border-t-2 border-white/70" />
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/70"
        style={{ width: "22%", height: "14%" }}
      />
      <div className="pointer-events-none absolute left-1/2 top-3 h-[14%] w-[46%] -translate-x-1/2 border-2 border-t-0 border-white/70" />
      <div className="pointer-events-none absolute left-1/2 bottom-3 h-[14%] w-[46%] -translate-x-1/2 border-2 border-b-0 border-white/70" />

      {FORMATIONS[formation].map((slot, slotIndex) => {
        const playerId = assignments.get(slotIndex)
        const player = playerId ? byId.get(playerId) : undefined
        const fit = player ? fitOf(player, slot.role) : "natural"

        return (
          <div
            key={slotIndex}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(slotIndex, e)}
            onClick={() => onSlotClick(slotIndex)}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center"
            style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
            title={
              player && fit === "unsuitable"
                ? t("squad.positionWarning", {
                    playerPosition: t(positionLabelKey(player.primaryPosition)),
                    slotPosition: t(positionLabelKey(slot.role)),
                  })
                : undefined
            }
          >
            {player ? (
              <div className="relative">
                <div
                  className={cn(
                    "flex size-11 flex-col items-center justify-center rounded-full border-2 text-[11px] font-bold text-white shadow-md",
                    fit === "unsuitable" ? "border-red-400 ring-2 ring-red-400" : "border-white/80"
                  )}
                  style={{ backgroundColor: accentColor }}
                >
                  {player.shirtNumber}
                </div>
                {fit === "secondary" && (
                  <span className="absolute -end-1 -top-1 size-3 rounded-full border border-white bg-orange-500" />
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(slotIndex)
                  }}
                  className="absolute -start-1 -top-1 flex size-4 items-center justify-center rounded-full bg-background text-[10px] text-muted-foreground shadow"
                >
                  ×
                </button>
                <div className="mt-0.5 max-w-16 truncate rounded bg-black/50 px-1 text-center text-[9px] text-white">
                  {fullName(player)}
                </div>
              </div>
            ) : (
              <div className="flex size-11 flex-col items-center justify-center rounded-full border-2 border-dashed border-white/70 bg-white/10 text-[9px] text-white/80">
                {t(positionLabelKey(slot.role))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function TacticDial({
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
      <h3 className="mb-2 text-sm font-semibold">{t(titleKey)}</h3>
      <div className="flex gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              "flex-1 rounded-md border px-2 py-1.5 text-sm",
              value === option ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"
            )}
          >
            {t(`${prefix}.${option}` as TranslationKey)}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {t(`${prefix}.${value}Desc` as TranslationKey)}
      </p>
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
