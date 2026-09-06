/**
 * BOTH LOCK ORDERS, PROVED AGAINST REAL POSTGRESQL WITH TWO LIVE CONNECTIONS.
 *
 * The unit tests assert that the right locks are taken in the right modes by
 * the right code. They cannot assert the thing that actually matters, because
 * it needs two transactions running at once: that shared and exclusive really
 * do exclude each other, and that BOTH possible interleavings produce a
 * settlement view and a replay view that AGREE.
 *
 * That agreement is the whole contract:
 *
 *   "If the mutation linearizes before settlement for T, the settlement sees
 *    the new economic state. If settlement linearizes first, the mutation
 *    belongs after T."
 *
 * WHY IT CANNOT BE A JEST TEST. Jest runs the suite against no database. This
 * needs two independent connections, real advisory locks, and real blocking -
 * so it lives with the other real-PostgreSQL proofs and runs from the same
 * PROOF_DATABASE_URL.
 *
 * Run with: PROOF_DATABASE_URL=postgresql://... npm run proof:linearization
 */
import { PrismaClient } from "../../src/generated/prisma"
import { resetProofDatabase } from "./reset"

const checks: { ok: boolean; label: string; detail: string }[] = []
function record(ok: boolean, label: string, detail = ""): void {
  checks.push({ ok, label, detail })
  console.info(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`)
}

/** A promise a test can resolve by hand, to hold a transaction open. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Did `promise` settle within `ms`? Used to observe that a lock actually blocks. */
async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  const marker = Symbol("pending")
  const result = await Promise.race([promise.then(() => "settled"), sleep(ms).then(() => marker)])
  return result !== marker
}

async function main(): Promise<void> {
  const url = process.env.PROOF_DATABASE_URL
  if (!url) {
    throw new Error("PROOF_DATABASE_URL is not set. This script wipes the database it is given; it will not guess one.")
  }
  if (process.env.PRODUCTION_DATABASE_URL && process.env.PRODUCTION_DATABASE_URL === url) {
    throw new Error("REFUSED: PROOF_DATABASE_URL equals PRODUCTION_DATABASE_URL.")
  }

  console.info("=== proof:linearization ===")
  console.info("Mode:     REAL PostgreSQL, two connections, real advisory locks")
  console.info("")

  await resetProofDatabase(url)

  // Two independent clients so the two transactions really are concurrent.
  // One client's interactive transaction holds one connection, so a single
  // client would serialise them and prove nothing.
  const a = new PrismaClient({ datasources: { db: { url } } })
  const b = new PrismaClient({ datasources: { db: { url } } })

  const { appendTeamEconomicState, acquireEconomyHistoryShared, acquireEconomyHistoryExclusive, economicStatesAsOf } =
    await import("../../src/lib/economy/state-history")

  try {
    await a.team.create({ data: { id: "lin-club", name: "Linearization FC", balance: 0 } })
    // A baseline row, so "as of T" always has something to find and the test is
    // about ORDER rather than about coverage.
    await a.$transaction(async (tx) => {
      await acquireEconomyHistoryShared(tx)
      await appendTeamEconomicState(tx, { teamId: "lin-club", reason: "baseline" })
    })
    const baseline = await a.$queryRaw<{ version: number }[]>`
      SELECT "version" FROM "TeamEconomicState" WHERE "teamId" = 'lin-club' ORDER BY "version" DESC LIMIT 1
    `
    record(baseline[0]?.version === 1, "baseline row exists at version 1", `v${baseline[0]?.version}`)

    // ==================================================================
    // ORDER 1 - THE MUTATION LINEARIZES FIRST.
    //
    // The appender takes shared and holds it. The settlement's exclusive
    // acquire must BLOCK until the appender commits; once it proceeds, its
    // read must SEE the appended row. That is "the settlement sees the new
    // economic state".
    // ==================================================================
    console.info("\n--- ORDER 1: mutation linearizes before the settlement ---")
    {
      const hold = deferred()
      let appendedAt: Date | null = null as Date | null

      const mutation = a.$transaction(
        async (tx) => {
          await acquireEconomyHistoryShared(tx)
          const state = await appendTeamEconomicState(tx, { teamId: "lin-club", reason: "release" })
          appendedAt = state.effectiveAt
          await hold.promise // hold the shared lock open
        },
        { timeout: 30_000 }
      )

      // Let the mutation get as far as holding the lock.
      while (!appendedAt) await sleep(10)

      let settlementSaw: number | null = null
      const settlement = b.$transaction(
        async (tx) => {
          await acquireEconomyHistoryExclusive(tx)
          const states = await economicStatesAsOf(tx, ["lin-club"], new Date())
          settlementSaw = states.get("lin-club")?.version ?? null
        },
        { timeout: 30_000 }
      )

      const proceededWhileHeld = await settledWithin(settlement, 700)
      record(!proceededWhileHeld, "the settlement BLOCKS while an appender holds the lock shared")

      hold.resolve()
      await mutation
      await settlement

      record(settlementSaw === 2, "once the appender commits, the settlement SEES its row", `version ${settlementSaw}`)

      // And a replay agrees with what the settlement saw - the same query, run
      // afterwards, resolves to the same row.
      const replay = await a.$queryRaw<{ version: number }[]>`
        SELECT "version" FROM "TeamEconomicState"
         WHERE "teamId" = 'lin-club' AND "effectiveAt" <= ${appendedAt}
         ORDER BY "effectiveAt" DESC, "version" DESC LIMIT 1
      `
      record(replay[0]?.version === settlementSaw, "REPLAY AGREES with the settlement view", `version ${replay[0]?.version}`)
    }

    // ==================================================================
    // ORDER 2 - THE SETTLEMENT LINEARIZES FIRST.
    //
    // The settlement takes exclusive and holds it. The appender's shared
    // acquire must BLOCK; when it finally runs, its effectiveAt - taken from
    // the database clock AFTER the lock - must be strictly AFTER the instant
    // the settlement priced. That is "the mutation belongs after T".
    // ==================================================================
    console.info("\n--- ORDER 2: the settlement linearizes before the mutation ---")
    {
      const hold = deferred()
      // Annotated explicitly: TypeScript narrows a `let` assigned only inside a
      // callback to `never` at the outer read, which is wrong here - the awaits
      // below guarantee the assignment has happened.
      let settlementInstant: Date | null = null as Date | null
      let settlementSaw: number | null = null

      const settlement = b.$transaction(
        async (tx) => {
          await acquireEconomyHistoryExclusive(tx)
          const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3) AS now`
          settlementInstant = rows[0].now
          const states = await economicStatesAsOf(tx, ["lin-club"], settlementInstant)
          settlementSaw = states.get("lin-club")?.version ?? null
          await hold.promise // hold the exclusive lock open
        },
        { timeout: 30_000 }
      )

      while (!settlementInstant) await sleep(10)

      let appendedVersion: number | null = null as number | null
      let appendedAt: Date | null = null as Date | null
      const mutation = a.$transaction(
        async (tx) => {
          await acquireEconomyHistoryShared(tx)
          const state = await appendTeamEconomicState(tx, { teamId: "lin-club", reason: "youth_promotion" })
          appendedVersion = state.version
          appendedAt = state.effectiveAt
        },
        { timeout: 30_000 }
      )

      const proceededWhileHeld = await settledWithin(mutation, 700)
      record(!proceededWhileHeld, "the appender BLOCKS while a settlement holds the lock exclusive")

      hold.resolve()
      await settlement
      await mutation

      record(settlementSaw === 2, "the settlement priced WITHOUT the blocked mutation", `version ${settlementSaw}`)
      record(appendedVersion === 3, "the mutation appended after it", `version ${appendedVersion}`)
      const appended: Date | null = appendedAt
      const settled: Date | null = settlementInstant
      record(
        appended !== null && settled !== null && appended.getTime() > settled.getTime(),
        "its effectiveAt is strictly AFTER the settled instant",
        `${appended?.toISOString()} > ${settled?.toISOString()}`
      )

      // THE AGREEMENT, restated as a query: replaying the settled instant still
      // resolves to the row the settlement used, not to the later mutation.
      const replay = await a.$queryRaw<{ version: number }[]>`
        SELECT "version" FROM "TeamEconomicState"
         WHERE "teamId" = 'lin-club' AND "effectiveAt" <= ${settlementInstant}
         ORDER BY "effectiveAt" DESC, "version" DESC LIMIT 1
      `
      record(replay[0]?.version === settlementSaw, "REPLAY AGREES with the settlement view", `version ${replay[0]?.version}`)
    }

    // ==================================================================
    // THE APPEND-ONLY GUARANTEE, at the database level.
    // ==================================================================
    console.info("\n--- APPEND ONLY: UPDATE, DELETE, TRUNCATE, FK RESTRICT ---")
    const refuses = async (label: string, sql: string) => {
      try {
        await a.$executeRawUnsafe(sql)
        record(false, label, "the statement SUCCEEDED - the guard is not in place")
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        record(true, label, message.split("\n").find((line) => line.includes("append only") || line.includes("foreign key")) ?? "refused")
      }
    }
    await refuses("UPDATE is refused", `UPDATE "TeamEconomicState" SET "reason" = 'tampered' WHERE "teamId" = 'lin-club'`)
    await refuses("DELETE is refused", `DELETE FROM "TeamEconomicState" WHERE "teamId" = 'lin-club'`)
    await refuses("TRUNCATE is refused", `TRUNCATE TABLE "TeamEconomicState"`)
    await refuses("deleting a club with history is refused (FK RESTRICT)", `DELETE FROM "Team" WHERE "id" = 'lin-club'`)

    // ==================================================================
    // THE PER-TEAM TOTAL ORDER.
    // ==================================================================
    console.info("\n--- TOTAL ORDER: version, not timestamp, breaks ties ---")
    {
      // Two rows at the SAME effectiveAt - exactly what a batched append
      // produces, since clock_timestamp() is evaluated once per statement.
      const tie = new Date("2030-01-01T00:00:00.000Z")
      await a.$executeRaw`
        INSERT INTO "TeamEconomicState"("id","teamId","effectiveAt","version","weeklyPayroll","attendanceQuality","reason")
        VALUES ('tie-a','lin-club',${tie},10,111,880,'development'),
               ('tie-b','lin-club',${tie},11,222,881,'development')
      `
      const picked = await economicStatesAsOf(a, ["lin-club"], tie)
      const state = picked.get("lin-club")
      record(state?.version === 11, "the higher version wins a same-timestamp tie", `version ${state?.version}`)
      record(state?.weeklyPayroll === 222, "and its values are the ones returned", `payroll ${state?.weeklyPayroll}`)

      try {
        await a.$executeRaw`
          INSERT INTO "TeamEconomicState"("id","teamId","effectiveAt","version","weeklyPayroll","attendanceQuality","reason")
          VALUES ('tie-c','lin-club',${tie},11,333,882,'development')
        `
        record(false, "a duplicate (teamId, version) is refused", "the insert SUCCEEDED")
      } catch {
        record(true, "a duplicate (teamId, version) is refused by the unique index")
      }
    }

    // ==================================================================
    // FAILS CLOSED before history begins.
    // ==================================================================
    console.info("\n--- FAILS CLOSED ---")
    try {
      await economicStatesAsOf(a, ["lin-club"], new Date("2000-01-01T00:00:00.000Z"))
      record(false, "an instant before history throws", "it returned a value instead")
    } catch (error) {
      record(
        error instanceof Error && error.name === "EconomicStateUnavailableError",
        "an instant before history throws rather than substituting current state",
        error instanceof Error ? error.name : ""
      )
    }
  } finally {
    await a.$disconnect()
    await b.$disconnect()
  }

  const failed = checks.filter((check) => !check.ok)
  console.info("")
  console.info(`LINEARIZATION PROOF: ${failed.length === 0 ? "PASS" : "FAIL"} (${checks.length - failed.length}/${checks.length})`)
  if (failed.length > 0) {
    for (const check of failed) console.error(`  FAILED: ${check.label}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error("proof:linearization crashed:", error instanceof Error ? error.message : error)
  process.exitCode = 1
})
