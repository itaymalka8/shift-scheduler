/**
 * THE ONE PLACE A CLUB'S STARTING XI IS PUT BACK TOGETHER.
 *
 * Before this, a retirement, a release or a sale deleted the departing
 * player's LineupSlot (squad-cleanup.ts) and nothing filled the hole. The
 * only rebuild in the codebase - leagues/seed.ts - fires solely when a club
 * has ZERO slots and is itself gated behind a backfill check that never looks
 * at lineups, so a club left with eight starters kept eight starters, and the
 * engine simulated eight against eleven without a word. This closes that.
 *
 * IT PRESERVES MANAGER INTENT. It is not a rebuild. Every slot that is still
 * legal is left exactly where the manager put it; only slots that are empty
 * or hold somebody who may no longer play are touched, and the replacement is
 * chosen by the SAME computeRecommendedLineup the squad screen and the
 * formation switcher already use - there is no second selection algorithm
 * here, only a smaller question asked of the existing one.
 *
 * IT NEVER INVENTS A PLAYER. If a club does not own enough eligible players
 * to fill the formation, this reports INSUFFICIENT_ELIGIBLE_PLAYERS and the
 * caller refuses to simulate. Generating an emergency footballer, promoting
 * a youth prospect or signing a free agent on somebody's behalf is a product
 * decision that belongs to a later phase, and guessing at it here would put
 * fictional players into a real league.
 */
import type { Prisma } from "@/generated/prisma"
import { FORMATIONS, DEFAULT_FORMATION, isFormationId, resolveFormationSlots, type FormationSlot } from "./formations"
import { computeRecommendedLineup } from "./recommend"
import { isSelectable, validateLineup, type LineupStarter } from "./availability"

export type LineupRepairStatus = "ok" | "insufficient"

export interface LineupRepairResult {
  teamId: string
  status: LineupRepairStatus
  /** Slots the manager had chosen that were still legal and were left alone. */
  kept: number
  /** Slots that were empty or held an unavailable player and were refilled. */
  replaced: number
  /** How many of the formation's slots are filled now. */
  filled: number
  slotCount: number
  /** Owned, ACTIVE, selectable players - the pool the repair had to work with. */
  eligible: number
}

/** Exactly what the repair needs to know about one owned player. */
const REPAIR_PLAYER_SELECT = {
  id: true,
  teamId: true,
  primaryPosition: true,
  secondaryPositions: true,
  overall: true,
  fitness: true,
  careerStatus: true,
  injuryMatchesRemaining: true,
  suspensionMatches: true,
} as const

function formationSlotsFor(team: { formation: string | null; customFormation: unknown }): FormationSlot[] {
  const slots = resolveFormationSlots(team.formation, team.customFormation)
  if (slots.length > 0) return slots
  // A club with no readable formation still has to field a team; the default
  // is the same one the squad screen falls back to.
  return [...FORMATIONS[isFormationId(team.formation) ? team.formation : DEFAULT_FORMATION]]
}

/**
 * Repairs one club's lineup against an open transaction.
 *
 * Callers pass their own `tx` so the repair commits with whatever caused it -
 * a retirement, a sale, a release - and a rolled-back removal can never leave
 * a lineup rebuilt around a player who is still there.
 */
export async function repairTeamLineup(tx: Prisma.TransactionClient, teamId: string): Promise<LineupRepairResult> {
  const team = await tx.team.findUniqueOrThrow({
    where: { id: teamId },
    select: { id: true, formation: true, customFormation: true },
  })
  const slots = formationSlotsFor(team)
  const slotCount = slots.length

  const players = await tx.player.findMany({ where: { teamId }, select: REPAIR_PLAYER_SELECT })
  const eligible = players.filter(isSelectable)
  const existing = await tx.lineupSlot.findMany({ where: { teamId }, select: { playerId: true, slotIndex: true } })

  const byId = new Map(players.map((p) => [p.id, p]))

  // WHICH OF THE MANAGER'S CHOICES SURVIVE. A slot is kept when it points at
  // a player this club still owns, who may still play, and whose slot index
  // is inside the current formation - and when no earlier slot already claimed
  // them (a duplicate is a corruption, not an intent worth preserving).
  const keptBySlot = new Map<number, string>()
  const claimed = new Set<string>()
  for (const slot of [...existing].sort((a, b) => a.slotIndex - b.slotIndex)) {
    if (slot.slotIndex < 0 || slot.slotIndex >= slotCount) continue
    if (keptBySlot.has(slot.slotIndex)) continue
    const player = byId.get(slot.playerId)
    if (!player || player.teamId !== teamId || !isSelectable(player)) continue
    if (claimed.has(slot.playerId)) continue
    keptBySlot.set(slot.slotIndex, slot.playerId)
    claimed.add(slot.playerId)
  }

  const vacantSlotIndexes: number[] = []
  for (let index = 0; index < slotCount; index++) {
    if (!keptBySlot.has(index)) vacantSlotIndexes.push(index)
  }

  // FILL ONLY THE HOLES, and ask the existing recommender to do it. It is
  // handed just the vacant slots and just the unclaimed eligible players, so
  // it cannot reshuffle a starter the manager deliberately placed.
  const bench = eligible.filter((p) => !claimed.has(p.id))
  const vacantSlots = vacantSlotIndexes.map((index) => slots[index])
  const fills =
    vacantSlots.length > 0 && bench.length > 0
      ? computeRecommendedLineup(
          vacantSlots,
          bench.map((p) => ({
            id: p.id,
            primaryPosition: p.primaryPosition,
            secondaryPositions: p.secondaryPositions,
            overall: p.overall,
            fitness: p.fitness,
            // Everyone in this pool is already selectable, so the
            // recommender's own unavailable-fallback can never trigger and
            // can never smuggle an ineligible player in.
            status: "available",
          }))
        )
      : []

  const writes: { slotIndex: number; playerId: string }[] = []
  for (const fill of fills) {
    writes.push({ slotIndex: vacantSlotIndexes[fill.slotIndex], playerId: fill.playerId })
  }

  // The slots that changed, and only those. A kept slot is not rewritten.
  const staleSlotIndexes = existing
    .filter((slot) => keptBySlot.get(slot.slotIndex) !== slot.playerId)
    .map((slot) => slot.slotIndex)
  const toClear = new Set<number>([...staleSlotIndexes, ...writes.map((w) => w.slotIndex)])

  if (toClear.size > 0) {
    await tx.lineupSlot.deleteMany({ where: { teamId, slotIndex: { in: [...toClear] } } })
  }
  // A player can hold only one slot (LineupSlot.playerId is unique), so a
  // player being moved into a vacancy must lose whatever row they had first.
  if (writes.length > 0) {
    await tx.lineupSlot.deleteMany({ where: { playerId: { in: writes.map((w) => w.playerId) } } })
    await tx.lineupSlot.createMany({ data: writes.map((w) => ({ teamId, ...w })) })
  }
  // Anything still pointing outside the formation, or at a player who left,
  // is removed rather than left to fail the validator forever.
  await tx.lineupSlot.deleteMany({
    where: { teamId, OR: [{ slotIndex: { gte: slotCount } }, { slotIndex: { lt: 0 } }] },
  })

  const filled = keptBySlot.size + writes.length
  return {
    teamId,
    status: filled === slotCount ? "ok" : "insufficient",
    kept: keptBySlot.size,
    replaced: writes.length,
    filled,
    slotCount,
    eligible: eligible.length,
  }
}

export interface LineupCheck {
  teamId: string
  legal: boolean
  slotCount: number
  starters: number
  eligible: number
  problems: string[]
  offenders: string[]
}

/**
 * Reads a club's CURRENT lineup and judges it against the canonical
 * definition. Read-only - it repairs nothing, so a caller can report on a
 * club without changing it.
 */
export async function checkTeamLineup(tx: Prisma.TransactionClient, teamId: string): Promise<LineupCheck> {
  const team = await tx.team.findUniqueOrThrow({
    where: { id: teamId },
    select: { id: true, formation: true, customFormation: true },
  })
  const slotCount = formationSlotsFor(team).length

  const slots = await tx.lineupSlot.findMany({
    where: { teamId },
    select: { slotIndex: true, player: { select: REPAIR_PLAYER_SELECT } },
  })
  const starters: LineupStarter[] = slots.map((slot) => ({
    playerId: slot.player.id,
    teamId: slot.player.teamId,
    slotIndex: slot.slotIndex,
    careerStatus: slot.player.careerStatus,
    injuryMatchesRemaining: slot.player.injuryMatchesRemaining,
    suspensionMatches: slot.player.suspensionMatches,
  }))

  const eligible = await tx.player.count({
    where: { teamId, careerStatus: "ACTIVE", injuryMatchesRemaining: 0, suspensionMatches: 0 },
  })
  const legality = validateLineup(teamId, slotCount, starters)

  return {
    teamId,
    legal: legality.legal,
    slotCount,
    starters: starters.length,
    eligible,
    problems: legality.problems,
    offenders: legality.offenders,
  }
}
