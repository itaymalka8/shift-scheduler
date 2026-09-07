import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { runPreflightCheck, runSeasonStatusCheck, runScheduledDryCheck } from "@/lib/production-ops/checks"

const CHECKS = {
  preflight: runPreflightCheck,
  "season-status": runSeasonStatusCheck,
  "scheduled-check": runScheduledDryCheck,
} as const

/**
 * Read-only production ops reporting - the door that lets
 * scripts/production/*.ts running from a Claude Code cloud session see
 * Production's DB state without ever holding PRODUCTION_DATABASE_URL. Runs
 * entirely with this app's own already-connected Prisma client
 * (@/lib/prisma) inside Production, using Production's own DATABASE_URL -
 * that connection string never has to leave Render for these checks. See
 * scripts/production/ops-check.ts for the caller.
 *
 * Same fail-closed auth convention as /api/internal/process-fixtures:
 * PRODUCTION_OPS_READ_TOKEN unset -> 503 (never silently allow), a
 * mismatched or missing Bearer token -> 401, constant-time comparison so
 * response timing can't leak how much of the token matched.
 */
export async function GET(request: Request) {
  const expected = process.env.PRODUCTION_OPS_READ_TOKEN
  if (!expected) {
    return NextResponse.json({ error: "NOT_CONFIGURED" }, { status: 503 })
  }

  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""
  const expectedBuf = Buffer.from(expected)
  const providedBuf = Buffer.from(provided)
  const authorized = expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf)
  if (!authorized) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
  }

  const url = new URL(request.url)
  const check = url.searchParams.get("check") ?? "preflight"
  const runner = CHECKS[check as keyof typeof CHECKS]
  if (!runner) {
    return NextResponse.json({ error: "UNKNOWN_CHECK", validChecks: Object.keys(CHECKS) }, { status: 400 })
  }

  const result = await runner()
  return NextResponse.json(result)
}
