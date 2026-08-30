import { prisma } from "@/lib/prisma"

// Every transfer window opens Thursday 00:00 and closes the following
// Friday 00:00, both Asia/Jerusalem - never the server's local timezone.
// opensAt <= now < closesAt, so Friday 00:00 itself is already closed.
const TRANSFER_WINDOW_TIME_ZONE = "Asia/Jerusalem"
const WINDOW_OPEN_WEEKDAY = 4 // Sun=0..Sat=6 (JS Date convention) - Thursday
const WINDOW_DURATION_DAYS = 1

// The window's own weekly cycle runs Monday->Sunday, anchored on the
// nearest Thursday: Mon/Tue/Wed look forward to their upcoming Thursday,
// Thu is itself, and Fri/Sat/Sun look back at the Thursday whose window
// already opened (1/2/3 days earlier). That's "the nearest Thursday" in a
// circular 7-day sense - the offset is always in [-3, +3], so `% 7` first
// (giving a value in [0, 6], since JS's `%` can return negative for a
// negative dividend) then re-centering by subtracting 7 when it's past the
// halfway point maps every weekday to its correctly-signed distance.
function daysToNearestThursday(weekday: number): number {
  const forwardDistance = (WINDOW_OPEN_WEEKDAY - weekday + 7) % 7 // always 0..6
  return forwardDistance > 3 ? forwardDistance - 7 : forwardDistance
}

export interface TransferWindowDefinition {
  weekKey: string
  opensAt: Date
  closesAt: Date
}

function assertValidDate(date: Date, label: string): void {
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label}: received an invalid Date`)
  }
}

interface YMD {
  year: number
  month: number // 1-12
  day: number
}

function getPart(parts: Intl.DateTimeFormatPart[], type: string): number {
  const value = parts.find((p) => p.type === type)?.value
  if (value === undefined) throw new Error(`Missing "${type}" part while formatting a zoned date`)
  return Number(value)
}

function getLocalYMD(date: Date, timeZone: string): YMD {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  return { year: getPart(parts, "year"), month: getPart(parts, "month"), day: getPart(parts, "day") }
}

// Weekday of a plain calendar date (0=Sunday..6=Saturday) - pure date math
// once the Y/M/D is already correct, deliberately not timezone-sensitive.
function weekdayOf(ymd: YMD): number {
  return new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day)).getUTCDay()
}

function addDays(ymd: YMD, days: number): YMD {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day))
  d.setUTCDate(d.getUTCDate() + days)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function ymdKey(ymd: YMD): string {
  return `${ymd.year}-${pad2(ymd.month)}-${pad2(ymd.day)}`
}

// Offset (ms) of `timeZone` at approximately `utcMillis`: local wall-clock
// time in the zone minus UTC - e.g. +10_800_000 (3h) for Asia/Jerusalem in
// summer, +7_200_000 (2h) in winter.
function getZoneOffsetMs(utcMillis: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMillis))
  const asUtc = Date.UTC(
    getPart(parts, "year"),
    getPart(parts, "month") - 1,
    getPart(parts, "day"),
    getPart(parts, "hour"),
    getPart(parts, "minute"),
    getPart(parts, "second")
  )
  return asUtc - utcMillis
}

// The UTC instant for a given wall-clock date/time in `timeZone` (e.g.
// "2026-08-27 00:00:00 Asia/Jerusalem"). Two passes so a target time that
// lands close to a DST transition still resolves against the correct
// offset, not the guess's.
function zonedTimeToUtc(ymd: YMD, hour: number, minute: number, second: number, timeZone: string): Date {
  const guess = Date.UTC(ymd.year, ymd.month - 1, ymd.day, hour, minute, second)
  const offset1 = getZoneOffsetMs(guess, timeZone)
  const offset2 = getZoneOffsetMs(guess - offset1, timeZone)
  return new Date(guess - offset2)
}

/**
 * Pure - no Prisma, no side effects. Resolves `now` (in Asia/Jerusalem local
 * terms) to its nearest transfer window: Mon/Tue/Wed resolve to their
 * upcoming Thursday, Thu resolves to itself, and Fri/Sat/Sun resolve back to
 * the Thursday whose window already opened.
 */
export function getTransferWindowDefinition(now: Date = new Date()): TransferWindowDefinition {
  assertValidDate(now, "getTransferWindowDefinition")

  const localToday = getLocalYMD(now, TRANSFER_WINDOW_TIME_ZONE)
  const weekday = weekdayOf(localToday)
  const thursday = addDays(localToday, daysToNearestThursday(weekday))
  const friday = addDays(thursday, WINDOW_DURATION_DAYS)

  return {
    weekKey: ymdKey(thursday),
    opensAt: zonedTimeToUtc(thursday, 0, 0, 0, TRANSFER_WINDOW_TIME_ZONE),
    closesAt: zonedTimeToUtc(friday, 0, 0, 0, TRANSFER_WINDOW_TIME_ZONE),
  }
}

/** Pure. True iff `now` falls in [window.opensAt, window.closesAt). */
export function isWithinTransferWindow(window: TransferWindowDefinition, now: Date = new Date()): boolean {
  assertValidDate(now, "isWithinTransferWindow")
  return now.getTime() >= window.opensAt.getTime() && now.getTime() < window.closesAt.getTime()
}

interface StoredTransferWindow {
  weekKey: string
  opensAt: Date
  closesAt: Date
}

// Shared by both paths that hand back a pre-existing row (the plain
// find-first-then-return path, and the "lost the create race" path below) -
// neither may return a row without checking it against what today's
// definition would compute first.
function assertMatchesDefinition(existing: StoredTransferWindow, definition: TransferWindowDefinition): void {
  if (
    existing.opensAt.getTime() !== definition.opensAt.getTime() ||
    existing.closesAt.getTime() !== definition.closesAt.getTime()
  ) {
    throw new Error(
      `Transfer window invariant violation for weekKey ${definition.weekKey}: stored ` +
        `opensAt=${existing.opensAt.toISOString()} closesAt=${existing.closesAt.toISOString()}, ` +
        `but recomputing now gives opensAt=${definition.opensAt.toISOString()} closesAt=${definition.closesAt.toISOString()}`
    )
  }
}

/**
 * DB. Upserts the current window by weekKey - safe to call repeatedly, from
 * a Mutation (createListing, purchase, ...) only, never from a GET/read
 * path. A window row is a frozen historical record once created: if one
 * already exists for this weekKey, its opensAt/closesAt are never silently
 * rewritten. If the stored values ever disagree with what today's
 * definition would recompute (e.g. a clock or timezone-logic bug, or a
 * manual edit), that's an invariant violation to raise loudly, not
 * auto-correct - whether this call found the row itself or lost a create
 * race to a concurrent call that just inserted it.
 */
export async function ensureTransferWindowExists(now: Date = new Date()) {
  const definition = getTransferWindowDefinition(now)

  const existing = await prisma.transferWindow.findUnique({ where: { weekKey: definition.weekKey } })
  if (existing) {
    assertMatchesDefinition(existing, definition)
    return existing
  }

  try {
    return await prisma.transferWindow.create({ data: definition })
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002") {
      // Lost the create race to a concurrent call for the same weekKey -
      // the row now exists. Still validate it before handing it back: a
      // concurrent winner is not exempt from the invariant check.
      const winner = await prisma.transferWindow.findUniqueOrThrow({ where: { weekKey: definition.weekKey } })
      assertMatchesDefinition(winner, definition)
      return winner
    }
    throw error
  }
}
