import type { Prisma, PrismaClient } from "@/generated/prisma"
import { generatePlayerName } from "./names"
import { DEFAULT_FORMATION, FORMATIONS, type PlayerPosition } from "./formations"

type DbClient = PrismaClient | Prisma.TransactionClient

const SQUAD_COMPOSITION: { position: PlayerPosition; count: number }[] = [
  { position: "GK", count: 2 },
  { position: "DF", count: 6 },
  { position: "MF", count: 6 },
  { position: "FW", count: 4 },
]

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
 * Creates an 18-player squad for a team and picks a default starting XI in
 * DEFAULT_FORMATION (best-rated player per position). Every offered
 * formation needs at most 4 DF / 5 MF / 3 FW, so this composition always
 * has enough depth to fill any of them plus bench cover.
 */
export async function generateSquad(db: DbClient, teamId: string): Promise<void> {
  const jerseyNumbers = shuffle(Array.from({ length: 18 }, (_, i) => i + 1))
  let jerseyIndex = 0

  const playersByPosition: Record<PlayerPosition, { id: string; rating: number }[]> = {
    GK: [],
    DF: [],
    MF: [],
    FW: [],
  }

  for (const { position, count } of SQUAD_COMPOSITION) {
    for (let i = 0; i < count; i++) {
      const rating = randomInt(48, 85)
      const player = await db.player.create({
        data: {
          teamId,
          name: generatePlayerName(),
          position,
          age: randomInt(17, 35),
          rating,
          jerseyNumber: jerseyNumbers[jerseyIndex++],
        },
      })
      playersByPosition[position].push({ id: player.id, rating })
    }
  }

  for (const position of Object.keys(playersByPosition) as PlayerPosition[]) {
    playersByPosition[position].sort((a, b) => b.rating - a.rating)
  }

  const used: Partial<Record<PlayerPosition, number>> = {}
  for (const slot of FORMATIONS[DEFAULT_FORMATION]) {
    const index = used[slot.position] ?? 0
    const player = playersByPosition[slot.position][index]
    used[slot.position] = index + 1
    if (!player) continue

    await db.lineupSlot.create({
      data: { teamId, playerId: player.id, x: slot.x, y: slot.y },
    })
  }

  await db.team.update({
    where: { id: teamId },
    data: { formation: DEFAULT_FORMATION, tacticStyle: "balanced" },
  })
}
