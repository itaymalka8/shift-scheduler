import type { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/prisma"
import { SeededRandom } from "@/lib/match/engine/rng"
import { extractPlayerAttributes } from "@/lib/players/attributes"
import { calculatePlayerMarketValue } from "@/lib/players/market-value"
import { calculatePlayerSalary } from "@/lib/economy/salary"
import { removePlayerFromSquad } from "@/lib/transfers/squad-cleanup"
import { lockPlayerRow } from "@/lib/players/locks"
import { SeasonLifecycleError } from "./errors"
import { developPlayer, developmentSeed, retirementSeed, rollRetirement } from "./player-development"

export interface PlayerSeasonLifecycleInput {
  seasonId: string
  /** Season.number - part of the deterministic seeds, so a re-run of the same season reproduces the same rolls. */
  seasonNumber: number
  playerId: string
}

export interface PlayerSeasonLifecycleResult {
  playerId: string
  /** true when a PlayerSeasonLifecycle row already existed - nothing was written. */
  alreadyProcessed: boolean
  /** true when the player was not ACTIVE (already RETIRED) - nothing was written, and no ledger row was created either. */
  skippedNotActive: boolean
  oldAge: number
  newAge: number
  oldOverall: number
  newOverall: number
  developed: boolean
  retired: boolean
  oldTeamId: string | null
  newTeamId: string | null
}

function unchangedResult(
  player: { id: string; age: number; overall: number; teamId: string | null },
  flags: { alreadyProcessed: boolean; skippedNotActive: boolean }
): PlayerSeasonLifecycleResult {
  return {
    playerId: player.id,
    alreadyProcessed: flags.alreadyProcessed,
    skippedNotActive: flags.skippedNotActive,
    oldAge: player.age,
    newAge: player.age,
    oldOverall: player.overall,
    newOverall: player.overall,
    developed: false,
    retired: false,
    oldTeamId: player.teamId,
    newTeamId: player.teamId,
  }
}

/**
 * One player's whole season transition - Development, Aging, Retirement, and
 * the resulting value/salary re-rating - against an already-open transaction.
 * Exported separately from processPlayerSeasonLifecycle so it can be driven
 * with a stub transaction client in tests; production callers should use the
 * wrapper below, which owns the transaction.
 *
 * Ordering matters and is deliberate:
 *
 *   1. Lock the Player row, via the shared lockPlayerRow helper, as the
 *      very first statement - the same lock every ownership/career-state
 *      path now takes first (Release, Purchase, Create Listing). That
 *      shared ordering is what keeps this transaction and a concurrent
 *      transfer from deadlocking on the listing/lineup/team rows they both
 *      touch. READ COMMITTED plus this row lock is enough here: the only
 *      cross-row invariant is the retirement cleanup, and every row it
 *      touches is reachable only through this same player.
 *   2. Re-check the ledger AFTER the lock, never before it. Two concurrent
 *      calls for the same player both find no ledger row if they check
 *      first; serialized behind the lock, the loser sees the winner's
 *      committed row and returns alreadyProcessed instead of ageing the
 *      player a second time.
 *   3. Everything else, then the PlayerSeasonLifecycle row, in this same
 *      transaction. That is what makes the whole step atomic: if anything
 *      fails before the ledger write, every Player mutation rolls back with
 *      it; if the ledger row is committed, all of that player's mutations
 *      committed with it. There is no state where a player has aged but
 *      carries no ledger row, or carries a ledger row without having aged.
 */
export async function runPlayerSeasonLifecycle(
  tx: Prisma.TransactionClient,
  input: PlayerSeasonLifecycleInput
): Promise<PlayerSeasonLifecycleResult> {
  // 1. Player row lock, first statement in the transaction - the shared
  // lock-ordering root (see lockPlayerRow).
  const locked = await lockPlayerRow(tx, input.playerId)
  if (!locked) {
    throw new SeasonLifecycleError("PLAYER_NOT_FOUND", `No such player: ${input.playerId}`)
  }

  // 2. Re-read the player inside the lock - never trust anything read
  // before it was held.
  const player = await tx.player.findUnique({ where: { id: input.playerId } })
  if (!player) {
    throw new SeasonLifecycleError("PLAYER_NOT_FOUND", `No such player: ${input.playerId}`)
  }

  // 3. Ledger re-check, also under the lock.
  const existing = await tx.playerSeasonLifecycle.findUnique({
    where: { seasonId_playerId: { seasonId: input.seasonId, playerId: input.playerId } },
  })

  if (existing) {
    return unchangedResult(player, { alreadyProcessed: true, skippedNotActive: false })
  }

  // A player who is already RETIRED is not processed at all, and gets no
  // ledger row: the batch below only ever selects ACTIVE players, so a
  // retired one has no season transition to record.
  if (player.careerStatus !== "ACTIVE") {
    return unchangedResult(player, { alreadyProcessed: false, skippedNotActive: true })
  }

  // Snapshot everything the result reports as "old" before any mutation -
  // never re-read it off `player` after the update below.
  const oldAge = player.age
  const oldOverall = player.overall
  const oldTeamId = player.teamId

  // 4a. Development - on the age the player has BEFORE aging.
  const development = developPlayer(
    {
      age: player.age,
      potential: player.potential,
      primaryPosition: player.primaryPosition,
      attributes: extractPlayerAttributes(player as unknown as Record<string, unknown>),
    },
    new SeededRandom(developmentSeed(player.id, input.seasonNumber))
  )

  // 4b. Aging.
  const newAge = oldAge + 1

  // 4c. Retirement roll - on the NEW age, from its own seed.
  const retired = rollRetirement(newAge, new SeededRandom(retirementSeed(player.id, input.seasonNumber)))

  const updateData: Prisma.PlayerUncheckedUpdateInput = {
    ...development.changed,
    age: newAge,
    // Never `overall += x`: this is the value the updated attributes actually
    // grade out at, straight from the shared calculator.
    overall: development.overall,
  }

  if (retired) {
    updateData.careerStatus = "RETIRED"

    if (oldTeamId) {
      // Same cleanup semantics as Release, minus the money: no
      // FinancialTransaction, no release fee. Retiring is not a transfer.
      const team = await tx.team.findUniqueOrThrow({
        where: { id: oldTeamId },
        select: { captainId: true, penaltyTakerId: true, freeKickTakerId: true, cornerTakerId: true },
      })

      // No OPEN listing may survive a retirement - including one whose
      // expiresAt has passed but the expiration processor hasn't reached yet.
      await tx.transferListing.updateMany({
        where: { playerId: player.id, status: "OPEN" },
        data: { status: "CANCELLED" },
      })

      // Lineup slot + only the captaincy/set-piece roles that are actually
      // theirs, through the helper Release and Purchase already share.
      await removePlayerFromSquad(tx, oldTeamId, player.id, team)

      updateData.teamId = null
    }
    // Player rows are never deleted, and PlayerMatchStats are left entirely
    // alone - a retired player keeps their whole career record.
    //
    // marketValue/weeklySalary are deliberately NOT recomputed for a retiring
    // player: every consumer of those fields (squad, economy, dashboard,
    // transfer market) reads players by teamId, and a retired player has
    // none, so the numbers are unreachable. This matches Release, which
    // likewise leaves them at their last ACTIVE values rather than re-rating
    // a player on their way out.
  } else {
    // 4d. Re-rate on the new overall AND the new age - both must already be
    // final here, which is why this runs after Development and Aging rather
    // than alongside Development.
    const rating = {
      overall: development.overall,
      age: newAge,
      potential: player.potential,
      primaryPosition: player.primaryPosition,
    }
    updateData.marketValue = calculatePlayerMarketValue({ ...rating, fitness: player.fitness })
    updateData.weeklySalary = calculatePlayerSalary(rating)
  }

  await tx.player.update({ where: { id: player.id }, data: updateData })

  // 5. The ledger row, last, inside the same transaction.
  await tx.playerSeasonLifecycle.create({
    data: { seasonId: input.seasonId, playerId: player.id },
  })

  return {
    playerId: player.id,
    alreadyProcessed: false,
    skippedNotActive: false,
    oldAge,
    newAge,
    oldOverall,
    newOverall: development.overall,
    developed: development.bumps > 0,
    retired,
    oldTeamId,
    newTeamId: retired ? null : oldTeamId,
  }
}

/** Runs one player's season transition in its own short transaction. */
export function processPlayerSeasonLifecycle(input: PlayerSeasonLifecycleInput): Promise<PlayerSeasonLifecycleResult> {
  return prisma.$transaction((tx) => runPlayerSeasonLifecycle(tx, input))
}

export const DEFAULT_LIFECYCLE_BATCH_SIZE = 25

export interface SeasonPlayerLifecycleOptions {
  /** How many players to fetch per pass. Each player still gets its own transaction. */
  batchSize?: number
}

export interface SeasonPlayerLifecycleSummary {
  seasonId: string
  seasonNumber: number
  processed: number
  alreadyProcessed: number
  developed: number
  retired: number
  failed: { playerId: string; message: string }[]
}

/**
 * Every ACTIVE player's season transition, owned players and free agents
 * alike (no teamId filter - a free agent still ages and can still retire).
 * RETIRED players are excluded at the query, so they are never re-processed.
 *
 * Deliberately NOT one transaction: players are fetched in small batches and
 * each is committed on its own, so a run can be interrupted at any point
 * without holding a long-lived transaction open. Resuming is just running it
 * again - the `lifecycleRecords: none` filter means already-processed players
 * are never selected a second time, so the next run picks up exactly where
 * the last one stopped.
 *
 * Termination is guaranteed: every selected player leaves its transaction
 * with a ledger row (created here, or already there from a concurrent
 * runner), and a player whose own transaction throws is excluded from
 * subsequent passes and reported in `failed` - so each pass strictly shrinks
 * the remaining set.
 *
 * This is a domain-level service with no schedule of its own: it does not
 * check Season.status or offseasonStage, and nothing here knows about cron.
 * Calling it only at the right point in the offseason is the future
 * orchestrator's job.
 */
export async function processSeasonPlayerLifecycle(
  seasonId: string,
  options: SeasonPlayerLifecycleOptions = {}
): Promise<SeasonPlayerLifecycleSummary> {
  const season = await prisma.season.findUnique({ where: { id: seasonId }, select: { id: true, number: true } })
  if (!season) {
    throw new SeasonLifecycleError("SEASON_NOT_FOUND", `No such season: ${seasonId}`)
  }

  const batchSize = options.batchSize ?? DEFAULT_LIFECYCLE_BATCH_SIZE
  const summary: SeasonPlayerLifecycleSummary = {
    seasonId: season.id,
    seasonNumber: season.number,
    processed: 0,
    alreadyProcessed: 0,
    developed: 0,
    retired: 0,
    failed: [],
  }
  const failedIds: string[] = []

  for (;;) {
    const batch = await prisma.player.findMany({
      where: {
        careerStatus: "ACTIVE",
        lifecycleRecords: { none: { seasonId: season.id } },
        ...(failedIds.length > 0 ? { id: { notIn: failedIds } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: batchSize,
    })
    if (batch.length === 0) break

    for (const { id } of batch) {
      try {
        const result = await processPlayerSeasonLifecycle({
          seasonId: season.id,
          seasonNumber: season.number,
          playerId: id,
        })
        if (result.alreadyProcessed) {
          summary.alreadyProcessed++
          continue
        }
        summary.processed++
        if (result.developed) summary.developed++
        if (result.retired) summary.retired++
      } catch (error) {
        failedIds.push(id)
        summary.failed.push({ playerId: id, message: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  return summary
}
