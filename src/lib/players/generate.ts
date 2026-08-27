import type { Prisma, PrismaClient } from "@/generated/prisma"
import { generatePlayerName } from "./names"
import { DEFAULT_FORMATION } from "./formations"
import { computeRecommendedLineup } from "./recommend"
import type { PlayerPosition } from "./positions"

type DbClient = PrismaClient | Prisma.TransactionClient

// Covers every offered formation's starting needs (max 3 CB, 2 RB/LB/CDM,
// 3 CM, 1 CAM/RM/LM/RW/LW, 2 ST) with bench depth at every position.
const SQUAD_COMPOSITION: { position: PlayerPosition; count: number }[] = [
  { position: "GK", count: 2 },
  { position: "CB", count: 4 },
  { position: "RB", count: 2 },
  { position: "LB", count: 2 },
  { position: "CDM", count: 2 },
  { position: "CM", count: 3 },
  { position: "CAM", count: 2 },
  { position: "RM", count: 2 },
  { position: "LM", count: 2 },
  { position: "RW", count: 1 },
  { position: "LW", count: 1 },
  { position: "ST", count: 2 },
]
const SQUAD_SIZE = SQUAD_COMPOSITION.reduce((sum, c) => sum + c.count, 0)

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Creates a full squad for a team and picks a recommended starting XI in
 * DEFAULT_FORMATION so the team never starts with an empty pitch.
 */
export async function generateSquad(db: DbClient, teamId: string): Promise<void> {
  const jerseyNumbers = shuffle(Array.from({ length: SQUAD_SIZE }, (_, i) => i + 1))
  let jerseyIndex = 0

  const created: { id: string; position: string; rating: number; fitness: number; availability: string }[] = []

  for (const { position, count } of SQUAD_COMPOSITION) {
    for (let i = 0; i < count; i++) {
      const player = await db.player.create({
        data: {
          teamId,
          name: generatePlayerName(),
          position,
          age: randomInt(17, 35),
          rating: randomInt(48, 85),
          fitness: 100,
          availability: "available",
          jerseyNumber: jerseyNumbers[jerseyIndex++],
        },
      })
      created.push({
        id: player.id,
        position: player.position,
        rating: player.rating,
        fitness: player.fitness,
        availability: player.availability,
      })
    }
  }

  const assignments = computeRecommendedLineup(DEFAULT_FORMATION, created)
  for (const assignment of assignments) {
    await db.lineupSlot.create({
      data: { teamId, playerId: assignment.playerId, slotIndex: assignment.slotIndex },
    })
  }

  await db.team.update({
    where: { id: teamId },
    data: { formation: DEFAULT_FORMATION, mentality: "balanced", tempo: "normal", pressing: "normal", width: "balanced" },
  })
}
