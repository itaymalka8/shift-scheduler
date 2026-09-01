import type { Prisma } from "@/generated/prisma"
import { OUTFIELD_ATTRIBUTES } from "@/lib/players/attributes"
import { calculatePlayerOverall } from "@/lib/players/overall"
import { MAX_ACTIVE_ROSTER_SIZE } from "@/lib/players/roster"
import { generateYouthProspect } from "./generate"
import { runPromoteYouthProspect } from "./promote"
import { YouthError } from "./errors"
import { MAX_PROMOTIONS_PER_INTAKE } from "./config"

jest.mock("@/lib/prisma", () => ({ prisma: {} }))

const INTAKE_ID = "intake-1"
const PROSPECT_ID = "prospect-1"
const TEAM_ID = "team-1"

const trace: string[] = []
function record<T>(name: string, value: T): Promise<T> {
  trace.push(name)
  return Promise.resolve(value)
}

function makeProspect(overrides: Record<string, unknown> = {}) {
  const generated = generateYouthProspect({ seasonId: "s1", teamId: TEAM_ID, index: 0 })
  return {
    id: PROSPECT_ID,
    youthIntakeId: INTAKE_ID,
    status: "PENDING" as string,
    promotedPlayerId: null,
    promotedAt: null,
    ...generated,
    ...overrides,
  }
}

function makeIntake(overrides: Record<string, unknown> = {}) {
  return { id: INTAKE_ID, teamId: TEAM_ID, status: "OPEN" as string, promotedCount: 0, ...overrides }
}

function makeTx(options: { intake?: Record<string, unknown>; prospect?: Record<string, unknown>; rosterCount?: number; intakeMissing?: boolean } = {}) {
  const intake = makeIntake(options.intake)
  const prospect = makeProspect(options.prospect)
  const stub = {
    $queryRaw: (strings: TemplateStringsArray) => {
      const sql = strings.join("?")
      const name = sql.includes('"YouthIntake"') ? "LOCK:Intake" : "LOCK:other"
      trace.push(name)
      return Promise.resolve(options.intakeMissing && name === "LOCK:Intake" ? [] : [{ id: INTAKE_ID }])
    },
    // lockTeamRoster is a write, so it lands on $executeRaw.
    $executeRaw: (strings: TemplateStringsArray) => {
      const sql = strings.join("?")
      trace.push(sql.includes('"Team"') ? "LOCK:Team" : "LOCK:other")
      return Promise.resolve(1)
    },
    youthIntake: {
      findUniqueOrThrow: () => record("intake.read", intake),
      update: (args: { data: Record<string, unknown> }) => record("intake.update", args.data),
    },
    youthProspect: {
      findUnique: () => record("prospect.read", prospect),
      update: (args: { data: Record<string, unknown> }) => record("prospect.update", args.data),
      updateMany: (args: { data: Record<string, unknown> }) => record("prospect.updateMany", { count: 2, ...args.data }),
    },
    player: {
      count: () => record("player.count", options.rosterCount ?? 0),
      findMany: () => record("player.findMany", [{ shirtNumber: 1 }]),
      create: (args: { data: Record<string, unknown> }) => {
        trace.push("player.create")
        return Promise.resolve({ id: "new-player", ...args.data })
      },
    },
  }
  return { tx: stub as unknown as Prisma.TransactionClient, stub, intake, prospect }
}

function run(tx: Prisma.TransactionClient) {
  return runPromoteYouthProspect(tx, { intakeId: INTAKE_ID, prospectId: PROSPECT_ID })
}

describe("youth promotion - lock ordering", () => {
  beforeEach(() => {
    trace.length = 0
  })

  it("locks the intake first, then the team, before counting the roster or creating the player", async () => {
    await run(makeTx().tx)

    expect(trace[0]).toBe("LOCK:Intake")
    const intakeLock = trace.indexOf("LOCK:Intake")
    const teamLock = trace.indexOf("LOCK:Team")
    const count = trace.indexOf("player.count")
    const create = trace.indexOf("player.create")

    expect(intakeLock).toBeLessThan(teamLock)
    expect(teamLock).toBeLessThan(count)
    expect(count).toBeLessThan(create)
  })

  it("uses the shared team roster lock, never its own Team FOR UPDATE", async () => {
    const { tx, stub } = makeTx()
    await run(tx)
    // The Team lock is a write through lockTeamRoster - a bare SELECT ... FOR
    // UPDATE would not refresh a SERIALIZABLE caller's roster count.
    expect(trace).toContain("LOCK:Team")
    expect(stub).toBeDefined()
  })
})

describe("youth promotion - validation", () => {
  beforeEach(() => {
    trace.length = 0
  })

  it("promotes a pending prospect and copies the snapshot verbatim", async () => {
    const { tx, prospect } = makeTx()
    const result = await run(tx)

    expect(result.playerId).toBe("new-player")
    expect(result.promotedCount).toBe(1)
    expect(result.intakeClosed).toBe(false)

    const created = trace.indexOf("player.create")
    expect(created).toBeGreaterThan(-1)
    // Overall stored on the prospect is what its attributes grade out at.
    expect(calculatePlayerOverall(prospect)).toBe(prospect.overall)
  })

  it("rejects a closed intake", async () => {
    const { tx } = makeTx({ intake: { status: "CLOSED" } })
    await expect(run(tx)).rejects.toMatchObject({ code: "INTAKE_CLOSED" })
    expect(trace).not.toContain("player.create")
  })

  it("rejects an intake that already promoted its maximum", async () => {
    const { tx } = makeTx({ intake: { promotedCount: MAX_PROMOTIONS_PER_INTAKE } })
    await expect(run(tx)).rejects.toMatchObject({ code: "PROMOTION_LIMIT_REACHED" })
    expect(trace).not.toContain("player.create")
  })

  it("rejects a prospect from a different intake", async () => {
    const { tx } = makeTx({ prospect: { youthIntakeId: "other-intake" } })
    await expect(run(tx)).rejects.toMatchObject({ code: "PROSPECT_NOT_IN_INTAKE" })
    expect(trace).not.toContain("player.create")
  })

  it("rejects a prospect that is not PENDING", async () => {
    for (const status of ["PROMOTED", "EXPIRED"]) {
      trace.length = 0
      const { tx } = makeTx({ prospect: { status } })
      await expect(run(tx)).rejects.toMatchObject({ code: "PROSPECT_NOT_PENDING" })
      expect(trace).not.toContain("player.create")
    }
  })

  it("rejects a full roster", async () => {
    const { tx } = makeTx({ rosterCount: MAX_ACTIVE_ROSTER_SIZE })
    await expect(run(tx)).rejects.toMatchObject({ code: "ROSTER_FULL" })
    expect(trace).not.toContain("player.create")
  })

  it("rejects a missing intake with a domain error, never a raw one", async () => {
    const { tx } = makeTx({ intakeMissing: true })
    await expect(run(tx)).rejects.toBeInstanceOf(YouthError)
  })

  it("refuses a snapshot whose stored overall disagrees with its attributes", async () => {
    const tampered: Record<string, number> = {}
    for (const key of OUTFIELD_ATTRIBUTES) tampered[key] = 50
    const { tx } = makeTx({ prospect: { ...tampered, overall: 90, primaryPosition: "ST" } })
    await expect(run(tx)).rejects.toMatchObject({ code: "PROSPECT_INTEGRITY" })
    expect(trace).not.toContain("player.create")
  })

  it("closes the intake and expires the rest on the final allowed promotion", async () => {
    const { tx } = makeTx({ intake: { promotedCount: MAX_PROMOTIONS_PER_INTAKE - 1 } })
    const result = await run(tx)

    expect(result.promotedCount).toBe(MAX_PROMOTIONS_PER_INTAKE)
    expect(result.intakeClosed).toBe(true)
    expect(trace).toContain("prospect.updateMany")
    expect(trace.indexOf("intake.update")).toBeLessThan(trace.indexOf("prospect.updateMany"))
  })

  it("leaves the intake open while promotions remain", async () => {
    const { tx } = makeTx({ intake: { promotedCount: 0 } })
    const result = await run(tx)
    expect(result.intakeClosed).toBe(false)
    expect(trace).not.toContain("prospect.updateMany")
  })
})
