"use client"

import { useRef, useState } from "react"
import { useT } from "@/lib/i18n/locale-context"
import type { TranslationKey } from "@/lib/i18n/translations"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  FORMATIONS,
  TACTIC_STYLES,
  type FormationId,
  type PlayerPosition,
  type TacticStyle,
} from "@/lib/players/formations"

interface PlayerDTO {
  id: string
  name: string
  position: PlayerPosition
  age: number
  rating: number
  jerseyNumber: number
}

interface SlotDTO {
  playerId: string
  x: number
  y: number
}

const POSITIONS: PlayerPosition[] = ["GK", "DF", "MF", "FW"]

function buildLineupForFormation(
  formation: FormationId,
  currentLineup: Map<string, { x: number; y: number }>,
  players: PlayerDTO[]
): Map<string, { x: number; y: number }> {
  const byId = new Map(players.map((p) => [p.id, p]))

  const currentByPosition: Record<PlayerPosition, string[]> = { GK: [], DF: [], MF: [], FW: [] }
  for (const playerId of currentLineup.keys()) {
    const player = byId.get(playerId)
    if (player) currentByPosition[player.position].push(playerId)
  }

  const benchByPosition: Record<PlayerPosition, string[]> = { GK: [], DF: [], MF: [], FW: [] }
  for (const player of players) {
    if (!currentLineup.has(player.id)) benchByPosition[player.position].push(player.id)
  }
  for (const position of POSITIONS) {
    benchByPosition[position].sort((a, b) => (byId.get(b)?.rating ?? 0) - (byId.get(a)?.rating ?? 0))
  }

  const slotsByPosition: Record<PlayerPosition, { x: number; y: number }[]> = { GK: [], DF: [], MF: [], FW: [] }
  for (const slot of FORMATIONS[formation]) slotsByPosition[slot.position].push(slot)

  const next = new Map<string, { x: number; y: number }>()
  for (const position of POSITIONS) {
    const pool = [...currentByPosition[position], ...benchByPosition[position]]
    const slots = slotsByPosition[position]
    for (let i = 0; i < slots.length; i++) {
      const playerId = pool[i]
      if (playerId) next.set(playerId, { x: slots[i].x, y: slots[i].y })
    }
  }
  return next
}

export function TacticsBoard({
  players,
  initialSlots,
  initialFormation,
  initialTacticStyle,
  accentColor,
}: {
  players: PlayerDTO[]
  initialSlots: SlotDTO[]
  initialFormation: FormationId
  initialTacticStyle: TacticStyle
  accentColor: string
}) {
  const t = useT()
  const pitchRef = useRef<HTMLDivElement>(null)
  const byId = new Map(players.map((p) => [p.id, p]))

  const [formation, setFormation] = useState<FormationId>(initialFormation)
  const [tacticStyle, setTacticStyle] = useState<TacticStyle>(initialTacticStyle)
  const [lineup, setLineup] = useState<Map<string, { x: number; y: number }>>(
    () => new Map(initialSlots.map((s) => [s.playerId, { x: s.x, y: s.y }]))
  )
  const [selected, setSelected] = useState<{ source: "bench" | "pitch"; playerId: string } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")

  const benchIds = players.map((p) => p.id).filter((id) => !lineup.has(id))

  function handleFormationChange(next: FormationId) {
    setFormation(next)
    setLineup(buildLineupForFormation(next, lineup, players))
    setSelected(null)
    setSaveState("idle")
  }

  function handlePointerDown(playerId: string) {
    setDraggingId(playerId)
  }

  function updatePositionFromPointer(playerId: string, clientX: number, clientY: number) {
    const rect = pitchRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
    const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100))
    setLineup((prev) => new Map(prev).set(playerId, { x, y }))
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!draggingId) return
    updatePositionFromPointer(draggingId, e.clientX, e.clientY)
  }

  function handlePointerUp() {
    if (draggingId) setSaveState("idle")
    setDraggingId(null)
  }

  function handlePlayerClick(source: "bench" | "pitch", playerId: string) {
    if (draggingId) return
    if (!selected) {
      setSelected({ source, playerId })
      return
    }
    if (selected.playerId === playerId) {
      setSelected(null)
      return
    }
    if (selected.source === source) {
      setSelected({ source, playerId })
      return
    }

    // one bench + one pitch selected -> swap
    const benchPlayerId = source === "bench" ? playerId : selected.playerId
    const pitchPlayerId = source === "pitch" ? playerId : selected.playerId
    const pos = lineup.get(pitchPlayerId)
    if (pos) {
      setLineup((prev) => {
        const next = new Map(prev)
        next.delete(pitchPlayerId)
        next.set(benchPlayerId, pos)
        return next
      })
    }
    setSelected(null)
    setSaveState("idle")
  }

  async function handleSave() {
    setSaveState("saving")
    const slots = Array.from(lineup.entries()).map(([playerId, { x, y }]) => ({ playerId, x, y }))
    const res = await fetch("/api/squad/lineup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formation, tacticStyle, slots }),
    })
    setSaveState(res.ok ? "saved" : "idle")
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium">{t("squad.formation")}</span>
            <select
              className="rounded-md border bg-background px-2 py-1 text-sm"
              value={formation}
              onChange={(e) => handleFormationChange(e.target.value as FormationId)}
            >
              {Object.keys(FORMATIONS).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium">{t("squad.tacticStyle")}</span>
            <select
              className="rounded-md border bg-background px-2 py-1 text-sm"
              value={tacticStyle}
              onChange={(e) => {
                setTacticStyle(e.target.value as TacticStyle)
                setSaveState("idle")
              }}
            >
              {TACTIC_STYLES.map((style) => (
                <option key={style} value={style}>
                  {t(`squad.tactic${style[0].toUpperCase()}${style.slice(1)}` as TranslationKey)}
                </option>
              ))}
            </select>
          </label>

          <Button size="sm" onClick={handleSave} disabled={saveState === "saving"}>
            {saveState === "saved" ? t("squad.saved") : t("squad.save")}
          </Button>
        </div>

        <p className="mb-3 text-sm text-muted-foreground">{t("squad.dragHint")}</p>

        <div
          ref={pitchRef}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="relative mx-auto w-full max-w-md select-none overflow-hidden rounded-2xl shadow-xl"
          style={{
            aspectRatio: "2 / 3",
            transform: "perspective(1100px) rotateX(12deg)",
            transformOrigin: "center bottom",
            background:
              "repeating-linear-gradient(to bottom, #2f9e44 0%, #2f9e44 10%, #37b24d 10%, #37b24d 20%)",
            boxShadow: "0 25px 40px -15px rgba(0,0,0,0.5)",
          }}
        >
          {/* pitch markings */}
          <div className="pointer-events-none absolute inset-3 border-2 border-white/70" />
          <div className="pointer-events-none absolute left-3 right-3 top-1/2 border-t-2 border-white/70" />
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/70"
            style={{ width: "22%", height: "14%" }}
          />
          <div className="pointer-events-none absolute left-1/2 top-3 h-[14%] w-[46%] -translate-x-1/2 border-2 border-t-0 border-white/70" />
          <div className="pointer-events-none absolute left-1/2 bottom-3 h-[14%] w-[46%] -translate-x-1/2 border-2 border-b-0 border-white/70" />

          {Array.from(lineup.entries()).map(([playerId, pos]) => {
            const player = byId.get(playerId)
            if (!player) return null
            const isSelected = selected?.playerId === playerId
            return (
              <button
                key={playerId}
                type="button"
                onPointerDown={() => handlePointerDown(playerId)}
                onClick={() => handlePlayerClick("pitch", playerId)}
                className={cn(
                  "absolute flex size-9 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none flex-col items-center justify-center rounded-full border-2 text-[11px] font-bold text-white shadow-md active:cursor-grabbing",
                  isSelected ? "border-yellow-300 ring-2 ring-yellow-300" : "border-white/80"
                )}
                style={{ left: `${pos.x}%`, top: `${pos.y}%`, backgroundColor: accentColor }}
                title={`${player.name} (${player.rating})`}
              >
                {player.jerseyNumber}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">{t("squad.bench")}</h2>
        <ul className="space-y-1">
          {benchIds.map((id) => {
            const player = byId.get(id)
            if (!player) return null
            const isSelected = selected?.playerId === id
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => handlePlayerClick("bench", id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-sm hover:bg-accent",
                    isSelected && "border-primary bg-accent"
                  )}
                >
                  <span>
                    #{player.jerseyNumber} {player.name}
                  </span>
                  <span className="text-muted-foreground">
                    {t(`squad.position.${player.position}` as TranslationKey)} · {player.rating}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
