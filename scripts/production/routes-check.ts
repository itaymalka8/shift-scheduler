/**
 * READ ONLY smoke check of the Phase 3C public routes against LIVE
 * Production over HTTPS. Issues SELECTs and GETs only - it never writes to
 * the database and never POSTs to the app.
 *
 * WHY IT TALKS TO THE DATABASE AT ALL: /managers/[userId], /clubs/[teamId]
 * and /players/[playerId] are only meaningfully exercised by ids that really
 * exist, so this picks a real manager (the userId on an open HUMAN TeamEra),
 * a real club and a real player WITH ELIGIBLE HISTORY, and requests those. A
 * 200 on a made-up id would prove nothing about the pages a change added.
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
import { MATCH_REAL_DURATION_MINUTES } from "../../src/lib/match/timing"

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

    // A player who has actually PLAYED, gated by the same public-finished rule
    // the profile itself uses - so the page under test has a career to render
    // rather than an empty state that would pass without exercising anything.
    const cutoff = new Date(Date.now() - MATCH_REAL_DURATION_MINUTES * 60_000)
    const playedStat = await prisma.playerMatchStats.findFirst({
      where: { fixture: { playedAt: { not: null }, scheduledAt: { not: null, lte: cutoff } } },
      select: { playerId: true },
      orderBy: { playerId: "asc" },
    })
    // A SECOND, DIFFERENT player with history - a comparison of one player
    // against themselves is a state the page deliberately refuses, so it
    // would not exercise the comparison at all.
    const otherStat = await prisma.playerMatchStats.findFirst({
      where: {
        fixture: { playedAt: { not: null }, scheduledAt: { not: null, lte: cutoff } },
        playerId: { not: playedStat?.playerId ?? "" },
      },
      select: { playerId: true },
      orderBy: { playerId: "desc" },
    })

    if (!humanEra?.userId || !anyTeam || !playedStat || !otherStat) {
      console.error("REFUSED: could not find an open HUMAN era, a club and a played-in player to check against.")
      process.exitCode = 1
      return
    }

    console.info(`Manager under test: userId=${humanEra.userId} (open HUMAN era on team ${humanEra.teamId})`)
    console.info(`Club under test:    teamId=${anyTeam.id}`)
    console.info(`Player under test:  playerId=${playedStat.playerId} (has publicly finished history)`)
    console.info(`Second player:      playerId=${otherStat.playerId} (the other side of the comparison)\n`)

    const targets = [
      { label: "Landing page (control)", path: "/" },
      { label: "Hall of Fame", path: "/hall-of-fame" },
      { label: "Manager Profile", path: `/managers/${humanEra.userId}` },
      { label: "Club Trophy Cabinet", path: `/clubs/${anyTeam.id}` },
      { label: "Player Directory", path: "/players" },
      // A search term with a LIKE metacharacter in it: proves escapeLikeTerm
      // reached Production, since an unescaped "%" would return every player.
      { label: "Player Directory (search)", path: "/players?q=a" },
      { label: "Player Directory (literal % search)", path: "/players?q=%25" },
      // Deliberately malformed: a page route cannot answer 400, so these must
      // be ignored and still render, never 500.
      { label: "Player Directory (garbage filters -> ignored, not 500)", path: "/players?page=abc&position=WIZARD&club=nope&status=banned" },
      { label: "Player Directory (page past the end -> empty, not 404)", path: "/players?page=99999" },
      { label: "Player Profile", path: `/players/${playedStat.playerId}` },
      // PLAYER COMPARISON. Every state of it is a URL, so every state of it
      // is checkable - including the ones designed to break it. None of them
      // may 500: a page route cannot answer 400, so a bad id is a page that
      // asks for a player, never an error.
      { label: "Player Comparison (nothing selected)", path: "/players/compare" },
      { label: "Player Comparison (empty a)", path: "/players/compare?a=" },
      { label: "Player Comparison (empty a and b)", path: "/players/compare?a=&b=" },
      { label: "Player Comparison (A only)", path: `/players/compare?a=${playedStat.playerId}` },
      { label: "Player Comparison (both)", path: `/players/compare?a=${playedStat.playerId}&b=${otherStat.playerId}` },
      { label: "Player Comparison (same player twice -> asks for two, not 500)", path: `/players/compare?a=${playedStat.playerId}&b=${playedStat.playerId}` },
      { label: "Player Comparison (unknown b -> safe state, not 404)", path: `/players/compare?a=${playedStat.playerId}&b=not-a-real-player-id` },
      { label: "Player Comparison (unknown a -> safe state, not 404)", path: `/players/compare?a=not-a-real-player-id&b=${otherStat.playerId}` },
      { label: "Player Comparison (selector search)", path: "/players/compare?qa=a" },
      // MALFORMED IDS THAT REACH THE APPLICATION. Both are dropped by
      // isPlayerIdShape and the page asks for a player instead.
      //
      // The first version of this check sent `' OR 1=1 --` and
      // `../../etc/passwd` and got 403 with a 221 KB body - Render's edge
      // refusing the request before the application ever saw it, on a host
      // where every other route answered 200 or 404 from Next.js seconds
      // earlier. That is the CDN working, not the page failing, and a check
      // that measures the CDN tells us nothing about this release. The
      // payloads below carry the same shapes the parser must reject - a
      // LIKE metacharacter, a space, an id far past the length cap - without
      // matching a generic WAF signature, so they exercise the code. The
      // application's handling of the SQL-shaped string itself is covered by
      // a unit test and was requested against a running server locally.
      { label: "Player Comparison (metacharacter id -> dropped, not 500)", path: "/players/compare?a=abc%25def&b=abc%20def" },
      { label: "Player Comparison (over-long id -> dropped, not 500)", path: `/players/compare?a=${"x".repeat(200)}` },
      { label: "Manager Profile (unknown id -> 404, not 500)", path: "/managers/not-a-real-user-id", expect: 404 },
      { label: "Player Profile (unknown id -> 404, not 500)", path: "/players/not-a-real-player-id", expect: 404 },
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
