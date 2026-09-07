/**
 * REPRICING IDEMPOTENCY, PROVEN AGAINST A RECORDING CLIENT.
 *
 * The persistence half of this is proven against real PostgreSQL by
 * `npm run proof:economy`. What is proven HERE is the property that makes
 * persistence safe in the first place: the target wage is a pure function of
 * state this function does not modify, so running it again is not "running it
 * again" - it is asking the same question and getting the same answer.
 *
 * The fake client records every write, which is what lets the tests assert the
 * one thing a database test finds hardest to see: that the second run writes
 * NOTHING, rather than writing the same values a second time.
 */
import { PHASE_3R_ACTIVATION_START } from "./config"
import { calculatePhase3RSalary, calculateUncompressedPlayerSalary, type SalaryPlayer } from "./salary"
import { repriceLeagueSalaries } from "./salary-repricing"

interface Row extends SalaryPlayer {
  id: string
  weeklySalary: number
}

/** A minimal stand-in for the two Prisma calls repricing makes, that records writes. */
function fakeDb(rows: Row[]) {
  const updates: { ids: string[]; weeklySalary: number }[] = []
  const db = {
    player: {
      findMany: async () => rows.map((row) => ({ ...row })),
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { weeklySalary: number } }) => {
        updates.push({ ids: [...where.id.in], weeklySalary: data.weeklySalary })
        for (const row of rows) if (where.id.in.includes(row.id)) row.weeklySalary = data.weeklySalary
        return { count: where.id.in.length }
      },
    },
  }
  // The real client's type is far wider than the two calls used here; the cast
  // is the point of a fake, and every field repricing actually touches is real.
  return { db: db as unknown as Parameters<typeof repriceLeagueSalaries>[0], updates, rows }
}

const squad = (): Row[] => [
  { id: "a", overall: 78, age: 27, potential: 82, primaryPosition: "ST", weeklySalary: 0 },
  { id: "b", overall: 61, age: 20, potential: 88, primaryPosition: "CM", weeklySalary: 0 },
  { id: "c", overall: 44, age: 34, potential: 44, primaryPosition: "GK", weeklySalary: 0 },
  { id: "d", overall: 91, age: 29, potential: 91, primaryPosition: "CB", weeklySalary: 0 },
]

const AT = PHASE_3R_ACTIVATION_START

describe("repricing is idempotent", () => {
  it("first execution puts every player on the curve", async () => {
    const { db, rows } = fakeDb(squad())
    const result = await repriceLeagueSalaries(db, AT)
    expect(result.authority).toBe("phase3r")
    expect(result.examined).toBe(4)
    expect(result.repriced).toBe(4)
    for (const row of rows) expect(row.weeklySalary).toBe(calculatePhase3RSalary(row))
  })

  it("second execution writes NOTHING - not the same values again, nothing", async () => {
    const { db, updates } = fakeDb(squad())
    await repriceLeagueSalaries(db, AT)
    const writesAfterFirst = updates.length
    const second = await repriceLeagueSalaries(db, AT)
    expect(second.repriced).toBe(0)
    expect(second.alreadyCorrect).toBe(4)
    expect(updates.length).toBe(writesAfterFirst)
  })

  it("a crash retry - a first run whose writes were rolled back - lands on the same numbers", async () => {
    // Model the rollback exactly: the run happened, the answers were computed,
    // and the stored values reverted. The retry must reach the same place.
    const committed = fakeDb(squad())
    await repriceLeagueSalaries(committed.db, AT)

    const rolledBack = fakeDb(squad())
    await repriceLeagueSalaries(rolledBack.db, AT)
    for (const row of rolledBack.rows) row.weeklySalary = 0 // the rollback
    await repriceLeagueSalaries(rolledBack.db, AT)

    expect(rolledBack.rows.map((r) => r.weeklySalary)).toEqual(committed.rows.map((r) => r.weeklySalary))
  })

  it("a deploy retry - a fresh process against an already-repriced league - is a no-op", async () => {
    const { db } = fakeDb(squad())
    await repriceLeagueSalaries(db, AT)
    // A new process has no memory of the first run and must not need any.
    const afterRedeploy = await repriceLeagueSalaries(db, AT)
    expect(afterRedeploy.repriced).toBe(0)
    expect(afterRedeploy.weeklyBillBefore).toBe(afterRedeploy.weeklyBillAfter)
  })

  it("reaches the same answer whatever the stored wage was beforehand", async () => {
    // THE PROPERTY THE WHOLE DESIGN RESTS ON. A stored wage of zero, of a
    // legacy value, or of an absurd one all converge, because the stored wage
    // is not an input.
    const targets = squad().map((row) => calculatePhase3RSalary(row))
    for (const seed of [0, 1, 999_999_999]) {
      const rows = squad().map((row) => ({ ...row, weeklySalary: seed }))
      const { db } = fakeDb(rows)
      await repriceLeagueSalaries(db, AT)
      expect(rows.map((r) => r.weeklySalary)).toEqual(targets)
    }
  })
})

describe("repricing reads only the canonical columns", () => {
  it("never derives a wage from the current wage", async () => {
    // The negative control: if weeklySalary WERE an input, doubling it would
    // move the answer. It does not.
    const plain = squad()
    const inflated = squad().map((row) => ({ ...row, weeklySalary: 5_000_000 }))
    const a = fakeDb(plain)
    const b = fakeDb(inflated)
    await repriceLeagueSalaries(a.db, AT)
    await repriceLeagueSalaries(b.db, AT)
    expect(b.rows.map((r) => r.weeklySalary)).toEqual(a.rows.map((r) => r.weeklySalary))
  })

  it("asks the database for exactly the four canonical columns, and the wage only to compare", async () => {
    const source = (await import("node:fs")).readFileSync(
      (await import("node:path")).join(__dirname, "salary-repricing.ts"),
      "utf8"
    )
    const select = source.slice(source.indexOf("select: {"), source.indexOf("orderBy"))
    for (const column of ["overall", "age", "potential", "primaryPosition"]) {
      expect(select).toContain(`${column}: true`)
    }
    // weeklySalary is selected, and it is used ONLY to decide whether a write
    // is needed and to report the before/after bill - never fed to the curve.
    const body = source.slice(source.indexOf("for (const player of players)"))
    expect(body).toContain("calculateAuthoritativeSalary(player, at, undefined, activationStart)")
    expect(body).toContain("player.weeklySalary === target")
  })
})

describe("repricing before the boundary", () => {
  it("does nothing at all, and says so", async () => {
    const { db, updates, rows } = fakeDb(squad())
    const result = await repriceLeagueSalaries(db, new Date(PHASE_3R_ACTIVATION_START.getTime() - 1))
    expect(result.authority).toBe("legacy")
    expect(result.examined).toBe(0)
    expect(updates).toEqual([])
    // Not even onto the legacy curve: rewriting live wages before the boundary
    // that authorises the change would be a silent economic edit.
    expect(rows.every((row) => row.weeklySalary === 0)).toBe(true)
  })

  it("would have produced different numbers, so the no-op is a decision and not a coincidence", () => {
    for (const row of squad()) {
      expect(calculateUncompressedPlayerSalary(row)).not.toBe(calculatePhase3RSalary(row))
    }
  })
})

describe("what repricing never touches", () => {
  it("writes Player.weeklySalary and nothing else - no ledger row, no balance, no payroll history", async () => {
    const source = (await import("node:fs")).readFileSync(
      (await import("node:path")).join(__dirname, "salary-repricing.ts"),
      "utf8"
    )
    expect(source).not.toContain("financialTransaction")
    expect(source).not.toContain("createFinancialTransaction")
    expect(source).not.toContain("adjustClubBalance")
    expect(source).not.toContain("team.update")
    // The only write in the file.
    expect(source.match(/db\.player\.updateMany/g)?.length).toBe(1)
    expect(source).toContain("data: { weeklySalary: target }")
  })
})
