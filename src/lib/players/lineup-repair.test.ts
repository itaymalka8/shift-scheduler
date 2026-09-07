import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Prisma } from "@/generated/prisma"
import { repairTeamLineup } from "./lineup-repair"

/**
 * THE DEPARTING PLAYER IS NOT A CANDIDATE FOR THE SLOT HE IS VACATING.
 *
 * Purchase, Release and Retirement all clear a leaver's LineupSlot and repair
 * the lineup BEFORE they write the departure to the Player row. So at repair
 * time the database still says the club owns him, and the repair - reading
 * the database alone - would hand him back the slot it just cleared. Left
 * unchecked that produced three distinct broken states, one per departure
 * path: a sold player re-selected by the club selling him and then taken
 * away again by the buyer's own repair (LineupSlot.playerId is unique),
 * leaving TEN starters; a released player holding a slot at a club he no
 * longer belongs to; and a retiring player picked to start one more match.
 *
 * These run against a small in-memory transaction stub rather than Postgres,
 * so they assert the selection rule itself.
 */

const TEAM = "team-1"

interface StubPlayer {
  id: string
  teamId: string | null
  primaryPosition: string
  overall: number
}

function makeTx(players: StubPlayer[], slots: { slotIndex: number; playerId: string }[]) {
  let rows = slots.map((slot) => ({ teamId: TEAM, ...slot }))
  const tx = {
    team: {
      findUniqueOrThrow: async () => ({ id: TEAM, formation: "4-4-2", customFormation: null }),
    },
    player: {
      findMany: async ({ where }: { where: { teamId: string } }) =>
        players
          .filter((player) => player.teamId === where.teamId)
          .map((player) => ({
            ...player,
            secondaryPositions: [] as string[],
            fitness: 100,
            careerStatus: "ACTIVE",
            injuryMatchesRemaining: 0,
            suspensionMatches: 0,
          })),
    },
    lineupSlot: {
      findMany: async () => rows.map((row) => ({ playerId: row.playerId, slotIndex: row.slotIndex })),
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const slotIndex = where.slotIndex as { in?: number[]; gte?: number; lt?: number } | undefined
        const playerId = where.playerId as { in?: string[] } | undefined
        rows = rows.filter((row) => {
          if (playerId?.in?.includes(row.playerId)) return false
          if (slotIndex?.in?.includes(row.slotIndex)) return false
          if (where.OR !== undefined && (row.slotIndex >= 11 || row.slotIndex < 0)) return false
          return true
        })
        return { count: 0 }
      },
      createMany: async ({ data }: { data: { teamId: string; slotIndex: number; playerId: string }[] }) => {
        rows.push(...data)
        return { count: data.length }
      },
    },
  }
  return { tx: tx as unknown as Prisma.TransactionClient, current: () => [...rows].sort((a, b) => a.slotIndex - b.slotIndex) }
}

/** A 20-man squad whose STAR KEEPER is the best candidate for slot 0. */
function squad(): StubPlayer[] {
  const shape: [string, number][] = [
    ["GK", 90], ["GK", 50], ["GK", 50],
    ["CB", 65], ["CB", 65], ["CB", 65], ["CB", 65], ["CB", 65], ["RB", 65], ["LB", 65],
    ["CDM", 65], ["CM", 65], ["CM", 65], ["CM", 65], ["RM", 65], ["LM", 65],
    ["ST", 65], ["ST", 65], ["RW", 65], ["LW", 65],
  ]
  return shape.map(([primaryPosition, overall], index) => ({
    id: `p-${String(index).padStart(2, "0")}`,
    teamId: TEAM,
    primaryPosition,
    overall,
  }))
}

/**
 * A sensible 4-4-2 XI for the squad above - GK, RB, CB, CB, LB, RM, CM, CM,
 * LM, ST, ST - which leaves the two reserve keepers on the bench where a real
 * club would have them.
 */
const STARTING_ELEVEN = ["p-00", "p-08", "p-03", "p-04", "p-09", "p-14", "p-11", "p-12", "p-15", "p-16", "p-17"]

function eleven() {
  return STARTING_ELEVEN.map((playerId, slotIndex) => ({ slotIndex, playerId }))
}

/** The state a departure leaves behind: the leaver's slot deleted, his Player row untouched. */
function afterSlotCleared(leaver: string) {
  return { players: squad(), slots: eleven().filter((slot) => slot.playerId !== leaver) }
}

describe("repairTeamLineup and the player who is leaving", () => {
  it("re-selects the best candidate when nobody is declared departing", () => {
    // The unguarded behaviour, pinned deliberately: this is exactly what made
    // the exclusion necessary, and it must stay visible in the test suite.
    const leaver = "p-00"
    const { players, slots } = afterSlotCleared(leaver)
    const { tx, current } = makeTx(players, slots)
    return repairTeamLineup(tx, TEAM).then(() => {
      expect(current().map((row) => row.playerId)).toContain(leaver)
    })
  })

  it("never gives the departing player a slot", async () => {
    const leaver = "p-00"
    const { players, slots } = afterSlotCleared(leaver)
    const { tx, current } = makeTx(players, slots)
    const result = await repairTeamLineup(tx, TEAM, { departing: [leaver] })

    expect(current().map((row) => row.playerId)).not.toContain(leaver)
    expect(result.filled).toBe(11)
    expect(result.status).toBe("ok")
  })

  it("still fills the vacancy, from somebody who is staying", async () => {
    const leaver = "p-00"
    const { players, slots } = afterSlotCleared(leaver)
    const { tx, current } = makeTx(players, slots)
    await repairTeamLineup(tx, TEAM, { departing: [leaver] })

    const rows = current()
    expect(rows).toHaveLength(11)
    expect(new Set(rows.map((row) => row.slotIndex)).size).toBe(11)
    // The goalkeeping slot went to one of the two remaining keepers.
    const keeper = rows.find((row) => row.slotIndex === 0)
    expect(["p-01", "p-02"]).toContain(keeper?.playerId)
  })

  it("drops a slot the departing player somehow still holds", async () => {
    // Defence in depth: even if a caller repairs without deleting the slot
    // first, the leaver is not kept in it.
    const leaver = "p-00"
    const { tx, current } = makeTx(squad(), eleven())
    await repairTeamLineup(tx, TEAM, { departing: [leaver] })

    expect(current().map((row) => row.playerId)).not.toContain(leaver)
    expect(current()).toHaveLength(11)
  })

  it("leaves an untouched lineup alone when the departing list is empty", async () => {
    const { tx, current } = makeTx(squad(), eleven())
    const result = await repairTeamLineup(tx, TEAM, { departing: [] })

    expect(result.kept).toBe(11)
    expect(result.replaced).toBe(0)
    expect(current().map((row) => row.playerId)).toEqual(STARTING_ELEVEN)
  })
})

describe("every departure path names the leaver", () => {
  const cleanup = readFileSync(join(__dirname, "..", "transfers", "squad-cleanup.ts"), "utf8")

  it("the shared cleanup passes the departing player to the repair", () => {
    expect(cleanup).toContain("repairTeamLineup(tx, teamId, { departing: [playerId] })")
  })

  it("...and it is the only repair the cleanup runs", () => {
    expect(cleanup.match(/repairTeamLineup\(/g) ?? []).toHaveLength(1)
  })
})
