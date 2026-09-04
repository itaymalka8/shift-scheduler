/**
 * READ ONLY smoke check of the Phase 3C public routes against LIVE
 * Production over HTTPS. Issues SELECTs and GETs only - it never writes to
 * the database and never POSTs to the app.
 *
 * WHY IT TALKS TO THE DATABASE AT ALL: /managers/[userId] and
 * /clubs/[teamId] are only meaningfully exercised by ids that really exist,
 * so this picks a real manager (the userId on an open HUMAN TeamEra) and a
 * real club, and requests those. A 200 on a made-up id would prove nothing
 * about the pages the change actually added.
 *
 * It prints club ids and user ids - the same identifiers prod:eras:verify
 * already prints - and no personal data: no email, no display name.
 *
 * Neither route is behind middleware (see middleware.ts's matcher, which
 * covers /club/:path* but not /clubs/:path* and not /managers at all), so
 * an unauthenticated GET is the correct check for both.
 *
 * Run with: npm run prod:routes:check
 */
import { createProductionClient } from "../../src/lib/production/client"

const DEFAULT_BASE_URL = "https://goalx-manager.onrender.com"

let failures = 0

function check(label: string, ok: boolean, detail: string) {
  if (!ok) failures++
  console.info(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`)
}

async function get(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url, { redirect: "manual", headers: { "User-Agent": "goalx-prod-routes-check" } })
  return { status: response.status, body: await response.text() }
}

async function main() {
  console.info("=== prod:routes:check ===")
  console.info("Mode:     READ ONLY - SELECTs and GETs only\n")

  const baseUrl = (process.env.PRODUCTION_APP_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "")
  console.info(`Base URL: ${baseUrl}`)

  try {
    const { prisma, target } = createProductionClient()
    console.info(`Database: host=${target.host} name=${target.database}\n`)

    const humanEra = await prisma.teamEra.findFirst({
      where: { type: "HUMAN", endedAt: null },
      select: { userId: true, teamId: true },
      orderBy: { startedAt: "asc" },
    })
    const anyTeam = await prisma.team.findFirst({ select: { id: true }, orderBy: { id: "asc" } })

    if (!humanEra?.userId || !anyTeam) {
      console.error("REFUSED: could not find an open HUMAN era and a club to check against.")
      process.exitCode = 1
      return
    }

    console.info(`Manager under test: userId=${humanEra.userId} (open HUMAN era on team ${humanEra.teamId})`)
    console.info(`Club under test:    teamId=${anyTeam.id}\n`)

    const targets = [
      { label: "Landing page (control)", path: "/" },
      { label: "Hall of Fame", path: "/hall-of-fame" },
      { label: "Manager Profile", path: `/managers/${humanEra.userId}` },
      { label: "Club Trophy Cabinet", path: `/clubs/${anyTeam.id}` },
      { label: "Manager Profile (unknown id -> 404, not 500)", path: "/managers/not-a-real-user-id", expect: 404 },
    ]

    for (const t of targets) {
      const url = `${baseUrl}${t.path}`
      try {
        const { status, body } = await get(url)
        const expected = t.expect ?? 200
        check(t.label, status === expected, `${status} on ${t.path} (expected ${expected}, ${body.length} bytes)`)
      } catch (error) {
        check(t.label, false, `request failed: ${error instanceof Error ? error.message : error}`)
      }
    }

    console.info(`\nPRODUCTION ROUTES CHECK: ${failures === 0 ? "PASS" : "FAIL"}`)
    if (failures > 0) process.exitCode = 1
  } catch (error) {
    console.error("prod:routes:check failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
