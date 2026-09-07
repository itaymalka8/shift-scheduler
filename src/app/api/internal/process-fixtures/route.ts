import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { processDueFixtures } from "@/lib/match/simulate"

/**
 * The only HTTP door into processDueFixtures() - meant to be called by a
 * scheduler (an external cron pinger, or a manual ops trigger), never by a
 * browser navigation. Fails closed: if INTERNAL_JOB_SECRET isn't configured
 * at all, every request is rejected rather than silently allowed through.
 *
 * Prefer the direct-script path (scripts/process-due-fixtures.ts) for a
 * Render Cron Job - it talks to Postgres directly and never needs this
 * endpoint or a shared secret at all. This route exists for schedulers that
 * can only reach the deployment over HTTP, and for a manual "run it now".
 */
export async function POST(request: Request) {
  const expected = process.env.INTERNAL_JOB_SECRET
  if (!expected) {
    return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 })
  }

  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""
  const expectedBuf = Buffer.from(expected)
  const providedBuf = Buffer.from(provided)
  const authorized =
    expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf)
  if (!authorized) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const result = await processDueFixtures()
  return NextResponse.json(result)
}
