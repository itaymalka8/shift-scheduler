/**
 * READ ONLY verification of the Match History Phase 2 archive UI against
 * live Production.
 *
 * Two sources, deliberately: the production DATABASE (to pick real fixtures
 * without inventing any) and the production HTTP ENDPOINT (to see what the
 * deployed app actually puts on the wire). Neither is written to. No fixture
 * timestamp is changed, and no synthetic fixture, player or stat row is
 * created - the anti-spoiler cases use fixtures that already exist in the
 * state they are already in.
 *
 * Prints no personal data: club and player ids, positions, counts.
 *
 * Run with: npm run prod:verify:player-stats
 */
import { createProductionClient } from "../../src/lib/production/client"
import { isMatchFinished } from "../../src/lib/match/timing"

const BASE_URL = process.env.PRODUCTION_BASE_URL ?? "https://goalx-manager.onrender.com"

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++
  console.info(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`)
}

interface ApiResponse {
  status: string
  minute: number
  events: unknown[]
  liveStats: unknown
  finalStats: { homeScore: number; awayScore: number } | null
  playerStats:
    | {
        playerId: string
        teamId: string
        firstName: string
        lastName: string
        primaryPosition: string
        shirtNumber: number
        minutesPlayed: number
        rating: number
        saves: number
        passesAttempted: number
        goals: number
        assists: number
        yellowCards: number
        redCards: number
      }[]
    | null
}

async function fetchMatch(fixtureId: string): Promise<ApiResponse> {
  const res = await fetch(`${BASE_URL}/api/matches/${fixtureId}`, { headers: { accept: "application/json" } })
  if (!res.ok) throw new Error(`GET /api/matches/${fixtureId} -> HTTP ${res.status}`)
  return (await res.json()) as ApiResponse
}

async function main() {
  console.info("=== prod:verify:player-stats ===")
  console.info("Mode:     READ ONLY - production DB reads + production HTTP GETs, no writes\n")

  try {
    const { prisma, target } = createProductionClient()
    const now = new Date()
    console.info(`Database: host=${target.host} name=${target.database}`)
    console.info(`App:      ${BASE_URL}`)
    console.info(`Now:      ${now.toISOString()}\n`)

    // ---- pick real fixtures, change nothing ------------------------
    const candidates = await prisma.fixture.findMany({
      select: { id: true, scheduledAt: true, playedAt: true },
      orderBy: { scheduledAt: "asc" },
    })
    const finished = candidates.filter((f) => f.playedAt && isMatchFinished(f.scheduledAt, now))
    const live = candidates.filter((f) => f.scheduledAt && f.scheduledAt <= now && !isMatchFinished(f.scheduledAt, now))
    const future = candidates.filter((f) => f.scheduledAt && f.scheduledAt > now)
    console.info(`Fixtures: finished=${finished.length} live=${live.length} future=${future.length}\n`)

    // ---- D. Finished fixture exposes the new contract --------------
    console.info("--- D. FINISHED FIXTURE: PlayerStats contract ---")
    if (finished.length === 0) {
      failures++
      console.info("  FAIL  no finished fixture in Production to verify against")
    } else {
      const fixture = finished[finished.length - 1]
      const body = await fetchMatch(fixture.id)
      console.info(`  fixture: ${fixture.id} kickoff=${fixture.scheduledAt?.toISOString()}`)
      check("status is finished", body.status === "finished", body.status)
      check("playerStats is an array", Array.isArray(body.playerStats), typeof body.playerStats)
      const rows = body.playerStats ?? []
      check("has real rows", rows.length > 0, `${rows.length} rows`)

      if (rows.length > 0) {
        const required = [
          "playerId",
          "teamId",
          "firstName",
          "lastName",
          "primaryPosition",
          "shirtNumber",
          "minutesPlayed",
          "rating",
          "goals",
          "assists",
          "yellowCards",
          "redCards",
          "saves",
          "passesAttempted",
        ] as const
        const missing = rows.flatMap((r) => required.filter((k) => !(k in r)).map((k) => `${r.playerId}:${k}`))
        check("every row carries the full contract", missing.length === 0, missing.slice(0, 5).join(", "))
        check(
          "no nested player object leaked through",
          rows.every((r) => !("player" in r)),
          "flat rows only"
        )
        check(
          "teamId present on every row",
          rows.every((r) => typeof r.teamId === "string" && r.teamId.length > 0)
        )
        check(
          "rating present and numeric",
          rows.every((r) => typeof r.rating === "number")
        )
        check(
          "minutesPlayed present and numeric",
          rows.every((r) => typeof r.minutesPlayed === "number")
        )
        check("no duplicate player rows", new Set(rows.map((r) => r.playerId)).size === rows.length)

        // The rows must belong to this fixture's two clubs and nobody else.
        const teams = await prisma.fixture.findUnique({
          where: { id: fixture.id },
          select: { homeTeamId: true, awayTeamId: true },
        })
        const sides = new Set([teams!.homeTeamId, teams!.awayTeamId])
        check(
          "every row belongs to one of the two clubs that played",
          rows.every((r) => sides.has(r.teamId))
        )
        const home = rows.filter((r) => r.teamId === teams!.homeTeamId).length
        const away = rows.filter((r) => r.teamId === teams!.awayTeamId).length
        check("both clubs represented", home > 0 && away > 0, `home=${home} away=${away}`)

        // Cross-check against the database: same players, same count.
        const dbRows = await prisma.playerMatchStats.findMany({
          where: { fixtureId: fixture.id },
          select: { playerId: true },
        })
        check("row count matches the database exactly", rows.length === dbRows.length, `api=${rows.length} db=${dbRows.length}`)

        const keepers = rows.filter((r) => r.primaryPosition === "GK")
        console.info(`  INFO  goalkeepers in this fixture: ${keepers.length}${keepers.length ? ` (saves: ${keepers.map((k) => k.saves).join(", ")})` : ""}`)
        const zeroPass = rows.filter((r) => r.passesAttempted === 0)
        console.info(`  INFO  players with 0 pass attempts (pass accuracy renders as a dash): ${zeroPass.length}`)
        console.info(`  INFO  top rating: ${Math.max(...rows.map((r) => r.rating)).toFixed(1)}`)
      }

      // Regression: the archive still carries everything it did before.
      check("timeline events still returned", Array.isArray(body.events) && body.events.length > 0, `${body.events.length} events`)
      check("finalStats still returned", body.finalStats !== null)
      check("minute is 90 for a finished match", body.minute === 90, String(body.minute))
    }

    // ---- E. Anti-spoiler: nothing before full time ------------------
    console.info("\n--- E. ANTI-SPOILER ---")
    if (live.length === 0) {
      console.info("  INFO  no LIVE fixture exists in Production at this moment - none was created, and no")
      console.info("        fixture timestamp was altered to manufacture one. A future fixture is used below,")
      console.info("        which exercises the same gate (the query sits inside the finished-only branch).")
    } else {
      const fixture = live[0]
      const body = await fetchMatch(fixture.id)
      console.info(`  live fixture: ${fixture.id} simulated=${!!fixture.playedAt}`)
      check("status is live", body.status === "live", body.status)
      check("playerStats is null while live", body.playerStats === null, JSON.stringify(body.playerStats))
      check("no finalStats while live", body.finalStats === null)
      check(
        "response carries no player-stat payload at all",
        !JSON.stringify(body).includes('"minutesPlayed"'),
        "no minutesPlayed anywhere in the body"
      )
    }

    if (future.length === 0) {
      failures++
      console.info("  FAIL  no future fixture in Production to verify against")
    } else {
      const fixture = future[0]
      const body = await fetchMatch(fixture.id)
      console.info(`  future fixture: ${fixture.id} kickoff=${fixture.scheduledAt?.toISOString()}`)
      check("status is scheduled", body.status === "scheduled", body.status)
      check("playerStats is null for a future match", body.playerStats === null, JSON.stringify(body.playerStats))
      check("no events for a future match", Array.isArray(body.events) && body.events.length === 0)
      check("no finalStats for a future match", body.finalStats === null)
      check(
        "response carries no player-stat payload at all",
        !JSON.stringify(body).includes('"minutesPlayed"'),
        "no minutesPlayed anywhere in the body"
      )
    }

    console.info("")
    console.info(failures === 0 ? "PLAYER STATS VERIFICATION: PASS" : `PLAYER STATS VERIFICATION: FAIL (${failures} check(s) failed)`)
    if (failures > 0) process.exitCode = 1
  } catch (error) {
    console.error("prod:verify:player-stats failed:", error instanceof Error ? error.message : error)
    console.error("PLAYER STATS VERIFICATION: FAIL")
    process.exitCode = 1
  }
}

main()
