/**
 * THE ECONOMY'S MEMORY - reading and writing per-club economic history.
 *
 * WHY THE ECONOMY NEEDS A MEMORY AT ALL. Sponsor income settles at a weekly
 * boundary; attendance settles at a fixture's own kickoff. Both used to be
 * computed from the LIVE Player table at whatever moment the job happened to
 * run, so a settlement delayed by a Cron outage or a rolled-back transaction
 * priced a past instant using rosters that had since moved. Nothing persisted
 * could reconstruct Player.overall, weeklySalary, teamId or careerStatus as
 * they stood at a past instant - the Player row is current-state only - so
 * "what was this league worth at T" had no answer once anybody transferred,
 * released, retired or was promoted.
 *
 * WHY HISTORY RATHER THAN A SNAPSHOT PER WEEK. A snapshot has to be written AT
 * the instant it describes, which is exactly what an outage prevents: the job
 * that finally runs at T+30 can only see post-mutation state, and filing that
 * under T would manufacture a durable record of something that was never true.
 * History needs no foreknowledge of T. It records CHANGES, and every instant
 * lies between two changes, so an arbitrary T is answerable - including a
 * fixture's kickoff, which is never a weekly boundary.
 */
import { randomUUID } from "crypto"
import type { Prisma, PrismaClient } from "@/generated/prisma"
import { REPLACEMENT_OVERALL, ATTENDANCE_QUALITY_FLOOR } from "@/lib/stadium/attendance-quality"

type DbClient = PrismaClient | Prisma.TransactionClient

/**
 * THE ECONOMIC LINEARIZATION LOCK.
 *
 * effectiveAt is a timestamp, but the ORDER is established by this lock, not by
 * the clock - and that distinction is the whole correctness argument.
 *
 * PostgreSQL cannot tell a transaction its own commit time (the value does not
 * exist until the commit record is written), so no column can hold a true
 * commit timestamp without a mutable second pass, which an append-only table
 * forbids. Left to a bare clock, this failure is reachable: a mutation stamps
 * 12:59:59.950 and commits at 13:00:00.300; a settlement for 13:00:00.000 runs
 * at 13:00:00.100, cannot see the uncommitted row, and settles WITHOUT it -
 * while a later replay of `latest <= T` FINDS it. The stored ledger and the
 * reconstruction disagree, which is the one thing this subsystem exists to
 * prevent.
 *
 * The lock removes that. Appenders take it SHARED; settlement reads take it
 * EXCLUSIVE. Shared and exclusive are mutually exclusive, so for any mutation M
 * and settlement S exactly one of two orders happens, and both agree:
 *
 *   M FIRST  S blocks until M commits, then reads M's row and includes or
 *            excludes it purely by comparing effectiveAt to T. A later replay
 *            applies the identical comparison to the identical row. AGREE.
 *   S FIRST  M blocks at its shared acquire, so its clock_timestamp() - taken
 *            AFTER the lock, by contract - is evaluated only once S has
 *            committed. S ran at or after T, so M's stamp is strictly after T.
 *            S did not see M; replay excludes M. AGREE.
 *
 * There is no third order, because M's stamp can never be taken while S reads.
 * economy-linearization.test.ts drives BOTH orders against real PostgreSQL
 * rather than trusting this comment.
 */
const ECONOMY_HISTORY_LOCK = "goalx:economy:history"

/**
 * Taken by every appender. SHARED, so ordinary play does not serialise against
 * itself - two clubs transferring at the same moment is not a conflict.
 */
export async function acquireEconomyHistoryShared(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${ECONOMY_HISTORY_LOCK}))`
}

/**
 * Taken by every settlement that READS history as of an instant - the weekly
 * sponsor/maintenance/payroll run, and fixture simulation. EXCLUSIVE, so no
 * append can be mid-flight while an instant is being priced.
 *
 * Cost, against real volumes: one weekly settlement plus ~88 fixture
 * simulations per league-week, each holding it for a single transaction. A few
 * seconds of exclusive time per week in total.
 */
export async function acquireEconomyHistoryExclusive(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ECONOMY_HISTORY_LOCK}))`
}

/**
 * Which subsystem appended a row. AUDIT ONLY - no formula reads it - but the
 * negative mutation suite asserts each path appends under its own name, which
 * is how a forgotten appender is caught rather than discovered a season later.
 */
export type EconomicStateReason =
  | "baseline"
  | "registration"
  | "seed_backfill"
  | "replenishment"
  | "youth_promotion"
  | "transfer_in"
  | "transfer_out"
  | "release"
  | "development"
  | "retirement"
  | "repricing"

export interface TeamEconomicAggregates {
  weeklyPayroll: number
  attendanceQuality: number
}

/**
 * The two aggregates, computed from the club's ACTIVE owned players INSIDE the
 * caller's transaction - so they describe the roster as the mutation left it,
 * not as some later reader happens to find it.
 *
 * One statement, because two would be two different moments. The quality rule
 * is the shipped floor-plus-surplus rule, expressed in SQL against the same
 * constants calculateAttendanceQuality uses.
 */
export async function computeTeamAggregates(
  tx: Prisma.TransactionClient,
  teamId: string
): Promise<TeamEconomicAggregates> {
  const rows = await tx.$queryRaw<{ payroll: bigint | null; surplus: bigint | null }[]>`
    SELECT COALESCE(SUM(p."weeklySalary"), 0)::bigint AS payroll,
           COALESCE(SUM(GREATEST(p."overall" - ${REPLACEMENT_OVERALL}, 0)), 0)::bigint AS surplus
      FROM "Player" p
     WHERE p."teamId" = ${teamId} AND p."careerStatus" = 'ACTIVE'
  `
  const row = rows[0]
  return {
    weeklyPayroll: Number(row?.payroll ?? 0),
    attendanceQuality: ATTENDANCE_QUALITY_FLOOR + Number(row?.surplus ?? 0),
  }
}

export interface AppendEconomicStateInput {
  teamId: string
  reason: EconomicStateReason
  /**
   * THE ONE PERMITTED DOMAIN TIMESTAMP, and it is not a caller's clock.
   *
   * Ordinary appends omit this and are stamped from the DATABASE clock after
   * the locks have established order. Only the Phase 3R activation crossing
   * passes it, carrying PHASE_3R_ACTIVATION_START, because that crossing's
   * effective instant is contractually the constant rather than whenever the
   * Cron fired. That is admissible precisely because the value is (i) a
   * compile-time constant in committed source, (ii) identical for every club,
   * and (iii) the same instant the settling transaction is settling. No
   * request, page or retry can influence it. A second caller passing this is a
   * bug, and the mutation suite is built to catch it.
   */
  effectiveAt?: Date
}

export interface AppendedEconomicState extends TeamEconomicAggregates {
  teamId: string
  version: number
  effectiveAt: Date
}

/**
 * APPEND ONE CLUB'S STATE. Must run INSIDE the same transaction as the Player
 * mutation it describes, after the shared economy lock and after that club's
 * own lockTeamRoster.
 *
 * VERSION ALLOCATION, AND WHY MAX+1 CANNOT RACE. lockTeamRoster is deliberately
 * a WRITE (`UPDATE "Team" SET "name"="name"`) rather than a SELECT ... FOR
 * UPDATE - players/roster.ts records the roster-count bug that taught that
 * lesson. Because it produces a new row version: a READ COMMITTED caller blocks
 * and then re-reads a MAX that includes the holder's committed row, and a
 * SERIALIZABLE caller whose snapshot predates the commit raises 40001 and is
 * re-run from scratch by withSerializableRetry. Two transactions can never both
 * hold one club's Team row, so MAX+1 is evaluated under mutual exclusion per
 * club - exactly the scope the per-club invariant needs. UNIQUE(teamId,
 * version) then turns any lapse into a P2002 on the transaction that caused it.
 *
 * A mutable counter on Team was rejected: a second source of truth that can
 * drift from the table it counts, and a write hotspot on a row read by nearly
 * every request. MAX+1 derives the counter from the data it orders.
 *
 * THE CLOCK IS THE DATABASE'S. clock_timestamp() is evaluated in this INSERT,
 * which callers issue as the LAST statement of their transaction, so the gap
 * between stamp and commit is only the commit itself. Never `new Date()`: a
 * second clock in a second process is not an ordering authority, and this
 * project has already removed page and process clocks from every economic
 * decision. `AT TIME ZONE 'UTC'` because the column is timestamp(3) WITHOUT
 * time zone and Prisma stores UTC - without it the value would depend on the
 * session's TimeZone setting.
 *
 * NO MONOTONICITY CLAMP, deliberately. An earlier draft proposed forcing each
 * row past its club's previous effectiveAt. That is wrong here: the activation
 * crossing legitimately appends at T for a club that already has a later row
 * (see appendActivationStates), and a clamp would push the crossing forward and
 * break sponsor-at-T. The lock, not a clamp, is the ordering authority.
 */
export async function appendTeamEconomicState(
  tx: Prisma.TransactionClient,
  input: AppendEconomicStateInput
): Promise<AppendedEconomicState> {
  const aggregates = await computeTeamAggregates(tx, input.teamId)
  const domainInstant = input.effectiveAt ?? null

  const rows = await tx.$queryRaw<{ version: number; effectiveAt: Date }[]>`
    INSERT INTO "TeamEconomicState"
      ("id", "teamId", "effectiveAt", "version", "weeklyPayroll", "attendanceQuality", "reason")
    VALUES (
      ${randomUUID()},
      ${input.teamId},
      COALESCE(${domainInstant}::timestamp(3), (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)),
      (SELECT COALESCE(MAX("version"), 0) + 1 FROM "TeamEconomicState" WHERE "teamId" = ${input.teamId}),
      ${aggregates.weeklyPayroll},
      ${aggregates.attendanceQuality},
      ${input.reason}
    )
    RETURNING "version", "effectiveAt"
  `

  const inserted = rows[0]
  if (!inserted) {
    // RETURNING on a single-row INSERT cannot be empty; if it ever is, the
    // append did not happen and the caller must not proceed as though it had.
    throw new Error(`TeamEconomicState append returned no row for team ${input.teamId}`)
  }

  return {
    teamId: input.teamId,
    version: inserted.version,
    effectiveAt: inserted.effectiveAt,
    ...aggregates,
  }
}

/**
 * Raised when history cannot answer for an instant. Deliberately an ERROR and
 * never a fallback: a missing row means the coverage invariant was violated,
 * and the honest answer is "I cannot settle this", never a guess assembled
 * from current Player rows.
 */
export class EconomicStateUnavailableError extends Error {
  readonly teamIds: string[]
  readonly instant: Date

  constructor(teamIds: string[], instant: Date) {
    super(
      `No TeamEconomicState at or before ${instant.toISOString()} for ${teamIds.length} club(s): ` +
        `${teamIds.slice(0, 5).join(", ")}${teamIds.length > 5 ? ", ..." : ""}`
    )
    this.name = "EconomicStateUnavailableError"
    this.teamIds = teamIds
    this.instant = instant
  }
}

export interface EconomicStateAsOf extends TeamEconomicAggregates {
  teamId: string
  version: number
  effectiveAt: Date
}

/**
 * THE CANONICAL AS-OF READ, league-wide.
 *
 * One statement over ONE table. Player is not joined and cannot be, which is
 * what makes "never consults current Player state for a past instant"
 * structural rather than a habit.
 *
 * DISTINCT ON with ORDER BY (teamId, effectiveAt DESC, version DESC) returns
 * exactly one row per club, and the order is TOTAL - version alone is unique
 * per club - so the row chosen is deterministic rather than whichever the
 * planner happened to emit first. Same-timestamp rows, which batched appends
 * produce by construction, are resolved by version.
 *
 * FAILS CLOSED. Any club without an eligible row throws, naming the clubs and
 * the instant. There is no COALESCE, no zero row and no substitution.
 */
export async function economicStatesAsOf(
  db: DbClient,
  teamIds: readonly string[],
  instant: Date
): Promise<Map<string, EconomicStateAsOf>> {
  if (teamIds.length === 0) return new Map()

  const ids = [...teamIds]
  const rows = await db.$queryRaw<
    { teamId: string; version: number; effectiveAt: Date; weeklyPayroll: number; attendanceQuality: number }[]
  >`
    SELECT DISTINCT ON (s."teamId")
           s."teamId", s."version", s."effectiveAt", s."weeklyPayroll", s."attendanceQuality"
      FROM "TeamEconomicState" s
     WHERE s."teamId" = ANY(${ids}) AND s."effectiveAt" <= ${instant}
     ORDER BY s."teamId", s."effectiveAt" DESC, s."version" DESC
  `

  const byTeam = new Map<string, EconomicStateAsOf>(rows.map((row) => [row.teamId, row]))
  const missing = ids.filter((id) => !byTeam.has(id))
  if (missing.length > 0) throw new EconomicStateUnavailableError(missing, instant)
  return byTeam
}

/** One club's state as of an instant. Same contract, same failure mode. */
export async function economicStateAsOf(
  db: DbClient,
  teamId: string,
  instant: Date
): Promise<EconomicStateAsOf> {
  const states = await economicStatesAsOf(db, [teamId], instant)
  const state = states.get(teamId)
  if (!state) throw new EconomicStateUnavailableError([teamId], instant)
  return state
}

/**
 * Clubs that have no economic history at all. The coverage invariant the
 * baseline establishes and the activation readiness check enforces: a club
 * without a row cannot be settled, so activation must refuse rather than
 * discover it mid-week.
 */
export async function teamsWithoutEconomicHistory(db: DbClient): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT t."id"
      FROM "Team" t
     WHERE NOT EXISTS (SELECT 1 FROM "TeamEconomicState" s WHERE s."teamId" = t."id")
     ORDER BY t."id"
  `
  return rows.map((row) => row.id)
}

/**
 * Clubs whose earliest history begins at or after a given instant - i.e. clubs
 * for which that instant is NOT reconstructible. Used by the activation check
 * to prove every club was baselined strictly before the boundary.
 */
export async function teamsWithHistoryStartingAtOrAfter(db: DbClient, instant: Date): Promise<string[]> {
  const rows = await db.$queryRaw<{ teamId: string }[]>`
    SELECT s."teamId"
      FROM "TeamEconomicState" s
     GROUP BY s."teamId"
    HAVING MIN(s."effectiveAt") >= ${instant}
     ORDER BY s."teamId"
  `
  return rows.map((row) => row.teamId)
}

/**
 * THE ACTIVATION CROSSING'S HISTORY ROWS.
 *
 * Called from inside the sponsor settlement's transaction, immediately after
 * repriceLeagueSalaries has rewritten the league's wages and before the sponsor
 * median is read. Two appends per affected club, and both are needed:
 *
 *   AT `instant`  so the week being settled prices from post-repricing wages.
 *                 Without it, `latest <= instant` would find the club's
 *                 pre-crossing row and the first calibrated sponsor week would
 *                 be computed from legacy wages - roughly 1/0.7305 too high.
 *
 *   AT NOW        only for a club that already has a row AFTER `instant`. That
 *                 happens whenever the Cron is late: the boundary passes at T,
 *                 a manager releases a player at T+5 (correctly priced on the
 *                 legacy curve, since the crossing has not committed), and the
 *                 settlement finally runs at T+30. The T+5 row is historically
 *                 accurate for T+5 and must stay, but it is now the LATEST row
 *                 and would make every instant after it read legacy wages. A
 *                 second row at the current clock puts the post-crossing state
 *                 back in front.
 *
 * The domain timestamp is admissible here for the reasons set out on
 * AppendEconomicStateInput.effectiveAt: it is the settlement instant itself,
 * identical for every club, and reached from the committed activation grid
 * rather than from any caller.
 */
export async function appendRepricingStates(
  tx: Prisma.TransactionClient,
  teamIds: readonly string[],
  instant: Date
): Promise<number> {
  if (teamIds.length === 0) return 0

  const ids = [...teamIds]
  const laterRows = await tx.$queryRaw<{ teamId: string }[]>`
    SELECT s."teamId"
      FROM "TeamEconomicState" s
     WHERE s."teamId" = ANY(${ids})
     GROUP BY s."teamId"
    HAVING MAX(s."effectiveAt") > ${instant}
  `
  const needsForwardRow = new Set(laterRows.map((row) => row.teamId))

  let appended = 0
  // Ascending id, the project's documented order for anything touching many
  // clubs at once, so two runs issue the same statements in the same sequence.
  for (const teamId of [...ids].sort()) {
    await appendTeamEconomicState(tx, { teamId, reason: "repricing", effectiveAt: instant })
    appended++
    if (needsForwardRow.has(teamId)) {
      await appendTeamEconomicState(tx, { teamId, reason: "repricing" })
      appended++
    }
  }
  return appended
}
