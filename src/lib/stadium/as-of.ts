/**
 * WHAT THE STADIUM ACTUALLY WAS WHEN THE WHISTLE BLEW.
 *
 * THE SPORTING RULE, and it is one sentence: a construction job's seats
 * belong to fixture F if and only if `job.endsAt <= F.scheduledAt`.
 *
 * The Stadium row does not answer that question. It records what has been
 * MATERIALISED - the seats a completed job has already added to the four
 * columns - and materialisation happens whenever the settler last ran, which
 * before Phase 3P meant "whenever this club's manager last opened /stadium"
 * and after it means "on some cron tick". Either way it is a fact about
 * OBSERVATION, not about the match. Reading it raw makes a club's capacity,
 * its attendance and therefore its gate receipts depend on scheduling luck.
 *
 * TWO CORRECTIONS ARE NEEDED, NOT ONE. Phase 3O proposed only the first and
 * that would have been half a fix:
 *
 *   MATERIALISED BUT NOT YET EFFECTIVE  (endsAt AFTER kickoff, seats already
 *     in the Stadium row because the settler ran later)
 *     -> SUBTRACT them. The stand was not open when the match was played.
 *
 *   EFFECTIVE BUT NOT YET MATERIALISED  (endsAt AT OR BEFORE kickoff, job
 *     still active because the cron has not collected it yet)
 *     -> ADD them. The stand WAS open; nobody has written it down.
 *
 * With both, the answer no longer depends on when the settler ran at all.
 * A ten-day cron outage and a punctual cron produce the identical capacity
 * for the identical fixture, which is the property Phase 3P is required to
 * prove rather than assume.
 *
 * PER SEAT CLASS, NEVER JUST A TOTAL. Attendance is computed per seat type
 * and ticket prices differ by type, so collapsing to one capacity number
 * would get the revenue wrong even when the total is right.
 *
 * Pure: no Prisma, no clock, no I/O. The caller supplies the rows.
 */
import { SEAT_TYPES, type SeatCounts, type SeatType } from "./config"

/** Exactly what the as-of calculation needs to know about one construction job. */
export interface ConstructionJobReading {
  /** "pending" | "active" | "completed" - only "completed" has moved seats into the Stadium row. */
  status: string
  endsAt: Date
  regularSeatsAdded: number
  coveredSeatsAdded: number
  premiumSeatsAdded: number
  vipSeatsAdded: number
}

const SEATS_ADDED_FIELD: Record<SeatType, keyof ConstructionJobReading> = {
  regular: "regularSeatsAdded",
  covered: "coveredSeatsAdded",
  premium: "premiumSeatsAdded",
  vip: "vipSeatsAdded",
}

/** Has this job's work already been added to the Stadium row's seat columns? */
export function isMaterialised(job: ConstructionJobReading): boolean {
  return job.status === "completed"
}

/** Was this job finished, in game terms, at `asOf`? The boundary instant itself counts as finished. */
export function isEffectiveAt(job: ConstructionJobReading, asOf: Date): boolean {
  return job.endsAt.getTime() <= asOf.getTime()
}

function seatsOf(job: ConstructionJobReading, type: SeatType): number {
  return job[SEATS_ADDED_FIELD[type]] as number
}

export interface SeatsAsOfResult {
  seats: SeatCounts
  /** Jobs whose seats were removed because they finished after `asOf`. */
  subtracted: number
  /** Jobs whose seats were added because they finished by `asOf` but are not materialised yet. */
  added: number
}

/**
 * The club's seats as of `asOf`, corrected in BOTH directions.
 *
 * `materialised` is the Stadium row as it stands right now; `jobs` is every
 * construction job that stadium has ever had. A job on which materialisation
 * and effectiveness AGREE needs no correction, which is the overwhelmingly
 * common case and costs nothing.
 */
export function seatsAsOf(
  materialised: SeatCounts,
  jobs: readonly ConstructionJobReading[],
  asOf: Date | null
): SeatsAsOfResult {
  // A fixture with no scheduledAt has no kickoff instant, so "as of kickoff"
  // has no meaning for it. Report the stadium exactly as it stands - which is
  // what every reader did before this module existed - rather than inventing
  // a moment to measure against.
  if (asOf === null) return { seats: { ...materialised }, subtracted: 0, added: 0 }

  const seats: SeatCounts = { ...materialised }
  let subtracted = 0
  let added = 0

  for (const job of jobs) {
    const done = isMaterialised(job)
    const effective = isEffectiveAt(job, asOf)
    if (done === effective) continue

    if (done) {
      // Built into the row, but not finished when this match kicked off.
      for (const type of SEAT_TYPES) seats[type] -= seatsOf(job, type)
      subtracted++
    } else {
      // Finished before this match kicked off, but nobody has written it down.
      for (const type of SEAT_TYPES) seats[type] += seatsOf(job, type)
      added++
    }
  }

  // A negative stand is not a thing. Reaching this would mean the Stadium row
  // and its own job history disagree - clamp rather than hand the engine a
  // number it cannot use, and let the invariant checks be what shouts.
  for (const type of SEAT_TYPES) seats[type] = Math.max(0, seats[type])

  return { seats, subtracted, added }
}
