/**
 * THE WEEKLY ECONOMIC SETTLEMENT - everything the league owes and is owed at
 * one weekly boundary, in one order, settled by the clock and by nothing else.
 *
 * THE ORDER, AND WHY IT IS THIS ORDER:
 *
 *   1. REPRICE. Every active player's wage is recomputed from the calibrated
 *      curve before anything reads a wage bill. Sponsor income is derived from
 *      the league's median payroll and payroll IS the wage bill, so a
 *      settlement that ran before repricing would charge and credit against a
 *      league that was half on the old curve. It happens in the same
 *      transaction as the sponsor, under the same lock, so no settlement can
 *      ever observe a half-converted league.
 *
 *   2. SPONSOR, before payroll. A club should be able to meet its wage bill
 *      out of the week's income rather than out of last week's balance; paying
 *      wages first would push clubs into the red for the minutes between two
 *      transactions and make the ledger tell a story that never happened.
 *
 *   3. MAINTENANCE, after sponsor and before payroll. It belongs on the same
 *      side of the ledger as wages - a mandatory recurring cost of the assets
 *      the club chose to own - and settling it before payroll means the wage
 *      bill is the last thing charged, which is the charge managers are meant
 *      to feel.
 *
 *   4. PAYROLL, unchanged from Phase 3P. Its own transaction, its own lock,
 *      its own league-wide roster snapshot.
 *
 * STRICTLY ORDERED AND FAIL-FAST. If an earlier step throws, the later ones do
 * not run and the week stays incomplete, which is what the season-lifecycle
 * gate reads. A settlement that half-happened must not be able to look
 * finished.
 *
 * THREE SEPARATE TRANSACTIONS, NOT ONE. Each step is independently idempotent
 * under its own (teamId, referenceId) key, so a crash between steps costs a
 * retry rather than a rollback of work that already succeeded. One giant
 * transaction would hold Team row locks across a repricing of every player in
 * the league and would contend with any matchday running at the same instant -
 * for no benefit, because the ordering guarantee comes from the sequence and
 * the fail-fast, not from a shared commit.
 *
 * NOTHING HERE IS REACHABLE FROM A PAGE. The only caller is the scheduled job.
 * A page visit has never been allowed to settle money in this codebase and
 * this does not change that.
 */
import { prisma } from "@/lib/prisma"
import { createFinancialTransaction } from "./service"
import { economyEraAt } from "./activation"
import { calculateSponsorIncome, sponsorReferenceId, type SponsorClub } from "./sponsor"
import { calculateWeeklyMaintenance, maintenanceReferenceId } from "./maintenance"
import { repriceLeagueSalaries, type RepricingResult } from "./salary-repricing"
import { readSeasonTiersAsOf } from "./season-tier"
import { isPayrollDueForTeam, payrollReferenceId, payrollWeekKey, payrollWindow } from "./payroll-clock"
import { settlePayrollWeek, type PayrollWeekResult } from "./payroll"
import { seatsAsOf } from "@/lib/stadium/as-of"
import { toSeatCounts, type SeatCounts } from "@/lib/stadium/config"

/** One club's outcome for one settlement kind. */
export interface SettlementCharge {
  teamId: string
  amount: number
  /** False when a previous run had already written this club's row for this week. */
  settled: boolean
}

export interface SponsorWeekResult {
  weekKey: string
  instant: Date
  eligibleTeams: number
  teamsCredited: number
  teamsAlreadySettled: number
  totalCredited: number
  medianWeeklyPayroll: number
  meanTierMultiplier: number
  charges: SettlementCharge[]
  repricing: RepricingResult
}

export interface MaintenanceWeekResult {
  weekKey: string
  instant: Date
  eligibleTeams: number
  teamsCharged: number
  teamsAlreadySettled: number
  /** Clubs that owed nothing because they have never built above the starting ground. */
  teamsExempt: number
  totalCharged: number
  charges: SettlementCharge[]
}

export interface WeeklySettlementWeek {
  weekKey: string
  instant: Date
  era: "legacy" | "phase3r"
  sponsor: SponsorWeekResult | null
  maintenance: MaintenanceWeekResult | null
  /** Null when the week's wages were already settled and no transaction was opened. */
  payroll: PayrollWeekResult | null
}

export interface WeeklySettlementResult {
  weeksSettled: WeeklySettlementWeek[]
  weeksAlreadyComplete: number
  weeksOutsideWindow: number
  totalSponsorCredited: number
  totalMaintenanceCharged: number
  totalPayrollCharged: number
}

function sponsorLockKey(weekKey: string): string {
  return `goalx:sponsor:${weekKey}`
}
function maintenanceLockKey(weekKey: string): string {
  return `goalx:maintenance:${weekKey}`
}

/**
 * SETTLE ONE WEEK'S SPONSOR INCOME FOR THE WHOLE LEAGUE, ATOMICALLY - and
 * reprice the league on the way in.
 *
 * The lock, the single league-wide snapshot and the ascending-team-id write
 * order are the same three devices payroll uses, for the same three reasons:
 * two overlapping runs must not each take their own snapshot and pay different
 * medians; the median has to be ONE number for the whole week rather than
 * re-read per club; and ascending id is the project's documented lock order,
 * which is what stops this transaction and a concurrent transfer from forming
 * a cycle over the same Team rows.
 */
export async function settleSponsorWeek(instant: Date): Promise<SponsorWeekResult> {
  const weekKey = payrollWeekKey(instant)
  const referenceId = sponsorReferenceId(weekKey)

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sponsorLockKey(weekKey)}))`

      // 1. THE LEAGUE GOES ON THE CURVE BEFORE ANY WAGE IS READ.
      const repricing = await repriceLeagueSalaries(tx, instant)

      const teams = await tx.team.findMany({ select: { id: true, createdAt: true }, orderBy: { id: "asc" } })
      const eligible = teams.filter((team) => isPayrollDueForTeam(instant, team))
      const empty: SponsorWeekResult = {
        weekKey,
        instant,
        eligibleTeams: 0,
        teamsCredited: 0,
        teamsAlreadySettled: 0,
        totalCredited: 0,
        medianWeeklyPayroll: 0,
        meanTierMultiplier: 0,
        charges: [],
        repricing,
      }
      if (eligible.length === 0) return empty
      const eligibleIds = eligible.map((team) => team.id)

      // 2. THE CANONICAL WAGE SNAPSHOT - one query, one instant, read AFTER
      // the repricing above so the median is the calibrated league's median.
      const players = await tx.player.findMany({
        where: { teamId: { in: eligibleIds }, careerStatus: "ACTIVE" },
        select: { teamId: true, weeklySalary: true },
      })
      const payrollByTeam = new Map<string, number>()
      for (const player of players) {
        if (!player.teamId) continue
        payrollByTeam.set(player.teamId, (payrollByTeam.get(player.teamId) ?? 0) + player.weeklySalary)
      }

      // 3. TIER, AS OF THIS WEEK'S OWN INSTANT - season-scoped membership, never
      // current Team state, so a club promoted next season does not retroactively
      // change what it was paid this one.
      const tiers = await readSeasonTiersAsOf(tx, instant)

      const snapshot: SponsorClub[] = eligible.map((team) => ({
        teamId: team.id,
        weeklyPayroll: payrollByTeam.get(team.id) ?? 0,
        tier: tiers.tierByTeamId.get(team.id) ?? null,
      }))
      const calculation = calculateSponsorIncome(snapshot)

      const existing = await tx.financialTransaction.findMany({
        where: { teamId: { in: eligibleIds }, referenceId },
        select: { teamId: true },
      })
      const alreadySettled = new Set(existing.map((row) => row.teamId))

      const charges: SettlementCharge[] = []
      let totalCredited = 0
      for (const award of calculation.awards) {
        if (award.amount === 0) {
          charges.push({ teamId: award.teamId, amount: 0, settled: false })
          continue
        }
        if (alreadySettled.has(award.teamId)) {
          charges.push({ teamId: award.teamId, amount: award.amount, settled: false })
          continue
        }
        await createFinancialTransaction(tx, {
          teamId: award.teamId,
          type: "sponsorIncome",
          amount: award.amount,
          description: `הכנסות חסות שבועיות (ליגה ${award.tier})`,
          referenceId,
        })
        totalCredited += award.amount
        charges.push({ teamId: award.teamId, amount: award.amount, settled: true })
      }

      return {
        weekKey,
        instant,
        eligibleTeams: eligible.length,
        teamsCredited: charges.filter((charge) => charge.settled).length,
        teamsAlreadySettled: alreadySettled.size,
        totalCredited,
        medianWeeklyPayroll: calculation.medianWeeklyPayroll,
        meanTierMultiplier: calculation.meanTierMultiplier,
        charges,
        repricing,
      }
    },
    // Wider than payroll's: the first settled week also carries the one-time
    // repricing of every active player in the league.
    { timeout: 120_000, maxWait: 20_000 }
  )
}

/**
 * SETTLE ONE WEEK'S STADIUM UPKEEP FOR THE WHOLE LEAGUE.
 *
 * SEATS ARE RESOLVED BEFORE THE TRANSACTION OPENS, deliberately. The as-of
 * correction needs the Stadium row and its construction jobs, and a club that
 * has never expanded owes nothing at all - so there is no reason to hold Team
 * locks while working that out. It also means a club with no Stadium row at
 * all is simply exempt rather than causing a create-on-miss inside a
 * transaction, where a failed statement would poison the rest of it.
 */
export async function settleMaintenanceWeek(instant: Date): Promise<MaintenanceWeekResult> {
  const weekKey = payrollWeekKey(instant)
  const referenceId = maintenanceReferenceId(weekKey)

  // OUTSIDE the transaction: read every ground and every construction job once,
  // and correct each ground to what it actually was at this week's boundary.
  const stadiums = await prisma.stadium.findMany({
    select: {
      teamId: true,
      regularSeats: true,
      coveredSeats: true,
      premiumSeats: true,
      vipSeats: true,
      constructionJobs: {
        select: {
          status: true,
          endsAt: true,
          regularSeatsAdded: true,
          coveredSeatsAdded: true,
          premiumSeatsAdded: true,
          vipSeatsAdded: true,
        },
      },
    },
  })
  const seatsByTeam = new Map<string, SeatCounts>(
    stadiums.map((stadium) => [
      stadium.teamId,
      seatsAsOf(toSeatCounts(stadium), stadium.constructionJobs, instant).seats,
    ])
  )

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${maintenanceLockKey(weekKey)}))`

      const teams = await tx.team.findMany({ select: { id: true, createdAt: true }, orderBy: { id: "asc" } })
      const eligible = teams.filter((team) => isPayrollDueForTeam(instant, team))
      if (eligible.length === 0) {
        return {
          weekKey,
          instant,
          eligibleTeams: 0,
          teamsCharged: 0,
          teamsAlreadySettled: 0,
          teamsExempt: 0,
          totalCharged: 0,
          charges: [],
        }
      }
      const eligibleIds = eligible.map((team) => team.id)

      const existing = await tx.financialTransaction.findMany({
        where: { teamId: { in: eligibleIds }, referenceId },
        select: { teamId: true },
      })
      const alreadySettled = new Set(existing.map((row) => row.teamId))

      const charges: SettlementCharge[] = []
      let totalCharged = 0
      let teamsExempt = 0
      for (const team of eligible) {
        const seats = seatsByTeam.get(team.id)
        // No ground on file, or a ground no bigger than the one every club is
        // given: nothing to maintain and NO ledger row. A zero-valued upkeep
        // entry every week for sixty clubs would bury the ledger in noise that
        // says nothing happened.
        const breakdown = seats ? calculateWeeklyMaintenance(seats) : null
        if (!breakdown || breakdown.total === 0) {
          teamsExempt++
          charges.push({ teamId: team.id, amount: 0, settled: false })
          continue
        }
        if (alreadySettled.has(team.id)) {
          charges.push({ teamId: team.id, amount: breakdown.total, settled: false })
          continue
        }

        const extraSeats = Object.values(breakdown.chargeableSeats).reduce((sum, n) => sum + n, 0)
        await createFinancialTransaction(tx, {
          teamId: team.id,
          type: "stadiumMaintenance",
          amount: -breakdown.total,
          description: `אחזקת אצטדיון שבועית (${extraSeats.toLocaleString("he-IL")} מושבים מעבר לבסיס)`,
          referenceId,
        })
        totalCharged += breakdown.total
        charges.push({ teamId: team.id, amount: breakdown.total, settled: true })
      }

      return {
        weekKey,
        instant,
        eligibleTeams: eligible.length,
        teamsCharged: charges.filter((charge) => charge.settled).length,
        teamsAlreadySettled: alreadySettled.size,
        teamsExempt,
        totalCharged,
        charges,
      }
    },
    { timeout: 60_000, maxWait: 20_000 }
  )
}

/**
 * THE SCHEDULED ENTRY POINT: settle every weekly boundary that is due and not
 * yet complete, OLDEST FIRST, in the documented order within each week.
 *
 * Chronology is strict, exactly as payroll's own runner is: if an older week
 * fails, the run stops there rather than settling a newer week on top of an
 * unsettled older one.
 *
 * START-LINE ACTIVATION FOR THE NEW CHARGES. Sponsor and maintenance run only
 * for weeks at or after the Phase 3R boundary. A week that closed before it is
 * settled for payroll alone, exactly as it is today - there is no catch-up, no
 * retroactive sponsor and no retroactive upkeep, whether or not a ledger row
 * exists for that week.
 */
export async function settleWeeklyEconomy(now: Date = new Date()): Promise<WeeklySettlementResult> {
  const window = payrollWindow(now)
  const result: WeeklySettlementResult = {
    weeksSettled: [],
    weeksAlreadyComplete: 0,
    weeksOutsideWindow: window.weeksOutsideWindow,
    totalSponsorCredited: 0,
    totalMaintenanceCharged: 0,
    totalPayrollCharged: 0,
  }
  if (window.instants.length === 0) return result

  // THE IDLE TICK MUST STAY CHEAP, and that is a hard requirement rather than
  // a nicety: this runs every two minutes forever, and the healthy case is
  // that every week in the look-back window is already settled. Opening a
  // transaction and taking an advisory lock for each settlement of each of
  // twenty-six candidate weeks would be seventy-eight transactions to discover
  // there is nothing to do - the exact shape of the defect Phase 3P removed
  // from payroll.
  //
  // So the whole window is answered with THREE reads, and a settlement is
  // opened only for a week that genuinely needs one.
  const weekKeys = window.instants.map((instant) => payrollWeekKey(instant))
  const referenceIds = weekKeys.flatMap((weekKey) => [
    sponsorReferenceId(weekKey),
    maintenanceReferenceId(weekKey),
    payrollReferenceId(weekKey),
  ])
  const [teams, settled, expandedGrounds] = await Promise.all([
    prisma.team.findMany({ select: { id: true, createdAt: true } }),
    prisma.financialTransaction.findMany({
      where: { referenceId: { in: referenceIds } },
      select: { teamId: true, referenceId: true },
    }),
    // Which clubs could owe upkeep AT ALL. Today this is zero of sixty, so the
    // maintenance settlement is skipped outright rather than opening a
    // transaction to charge nobody. A club that expands appears here and the
    // skip stops applying.
    prisma.stadium.findMany({
      select: { teamId: true, regularSeats: true, coveredSeats: true, premiumSeats: true, vipSeats: true },
    }),
  ])

  const settledByReference = new Map<string, Set<string>>()
  for (const row of settled) {
    const bucket = settledByReference.get(row.referenceId) ?? new Set<string>()
    bucket.add(row.teamId)
    settledByReference.set(row.referenceId, bucket)
  }
  const owesUpkeep = new Set(
    expandedGrounds
      .filter((ground) => calculateWeeklyMaintenance(toSeatCounts(ground)).total > 0)
      .map((ground) => ground.teamId)
  )

  /** Is every club that would get a row for this reference already carrying one? */
  const complete = (referenceId: string, population: readonly { id: string }[]): boolean => {
    if (population.length === 0) return true
    const done = settledByReference.get(referenceId) ?? new Set<string>()
    return population.every((team) => done.has(team.id))
  }

  for (let i = 0; i < window.instants.length; i++) {
    const instant = window.instants[i]
    const weekKey = weekKeys[i]
    const era = economyEraAt(instant)
    const eligible = teams.filter((team) => isPayrollDueForTeam(instant, team))

    // Fail-fast and strictly ordered. Any throw propagates out of the runner,
    // leaves the week incomplete, and is what the season-lifecycle gate reads.
    //
    // Each `complete` check is a read the caller already did - it opens no
    // transaction and takes no lock. It is a fast path, not an authority: the
    // settlements below re-derive their own already-settled set under their own
    // lock, so a stale read here can only cost a wasted transaction, never a
    // double charge.
    const sponsor =
      era === "phase3r" && !complete(sponsorReferenceId(weekKey), eligible)
        ? await settleSponsorWeek(instant)
        : null
    const maintenance =
      era === "phase3r" &&
      owesUpkeep.size > 0 &&
      !complete(
        maintenanceReferenceId(weekKey),
        eligible.filter((team) => owesUpkeep.has(team.id))
      )
        ? await settleMaintenanceWeek(instant)
        : null
    const payroll = !complete(payrollReferenceId(weekKey), eligible) ? await settlePayrollWeek(instant) : null

    const didWork =
      (sponsor?.teamsCredited ?? 0) > 0 || (maintenance?.teamsCharged ?? 0) > 0 || (payroll?.teamsCharged ?? 0) > 0
    if (!didWork) {
      result.weeksAlreadyComplete++
      continue
    }

    result.weeksSettled.push({ weekKey, instant, era, sponsor, maintenance, payroll })
    result.totalSponsorCredited += sponsor?.totalCredited ?? 0
    result.totalMaintenanceCharged += maintenance?.totalCharged ?? 0
    result.totalPayrollCharged += payroll?.totalCharged ?? 0
  }

  return result
}
