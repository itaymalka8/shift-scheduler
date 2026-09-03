/**
 * The era write path, against a mocked transaction client. These assert the
 * ORDER and ATOMICITY of the writes - the properties that make the
 * invariant hold - rather than re-testing Prisma.
 */
import { closeEraAndOpenNext, ensureBotEra, lockTeamRow, recordHumanTakeover, TeamEraError } from "./eras"

const TEAM = "team-1"
const USER = "user-1"
const CLUB_CREATED = new Date("2026-08-01T00:00:00.000Z")
const TAKEOVER = new Date("2026-09-05T12:00:00.000Z")

interface FakeEra {
  id: string
  teamId: string
  userId: string | null
  type: "BOT" | "HUMAN"
  startedAt: Date
  endedAt: Date | null
}

/**
 * A transaction client that keeps eras in an array and enforces the same
 * one-open-era-per-team rule the partial unique index enforces in Postgres,
 * so a test can observe the constraint firing without a database.
 */
function makeTx(initial: FakeEra[] = []) {
  const eras = [...initial]
  const calls: string[] = []
  let nextId = initial.length + 1

  return {
    eras,
    calls,
    $queryRaw: jest.fn(async () => {
      calls.push("lock")
      return [{ id: TEAM }]
    }),
    teamEra: {
      findFirst: jest.fn(async ({ where }: { where: { teamId: string; endedAt: null } }) => {
        calls.push("findOpen")
        return eras.find((e) => e.teamId === where.teamId && e.endedAt === null) ?? null
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { endedAt: Date } }) => {
        calls.push("closeEra")
        const era = eras.find((e) => e.id === where.id)!
        era.endedAt = data.endedAt
        return era
      }),
      create: jest.fn(async ({ data }: { data: Omit<FakeEra, "id" | "endedAt"> }) => {
        calls.push("createEra")
        // The partial unique index: UNIQUE("teamId") WHERE "endedAt" IS NULL.
        if (eras.some((e) => e.teamId === data.teamId && e.endedAt === null)) {
          throw Object.assign(new Error("Unique constraint failed on TeamEra_teamId_open_key"), { code: "P2002" })
        }
        const era: FakeEra = { id: `era-${nextId++}`, endedAt: null, ...data }
        eras.push(era)
        return era
      }),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe("lockTeamRow", () => {
  it("takes a real row lock, not a plain read", async () => {
    const tx = makeTx()
    await lockTeamRow(tx, TEAM)
    // Prisma tagged templates arrive as (strings, ...values).
    const sql = (tx.$queryRaw.mock.calls[0][0] as string[]).join("?")
    expect(sql).toContain("FOR UPDATE")
    expect(sql).toContain('"Team"')
  })

  it("reports false when the team does not exist, rather than pretending it locked one", async () => {
    const tx = makeTx()
    tx.$queryRaw = jest.fn(async () => [])
    expect(await lockTeamRow(tx, "missing")).toBe(false)
  })
})

describe("a seeded bot club", () => {
  it("gets exactly one open BOT era with no user", async () => {
    const tx = makeTx()
    const era = await ensureBotEra(tx, TEAM, CLUB_CREATED)

    expect(era).toMatchObject({ teamId: TEAM, type: "BOT", userId: null, startedAt: CLUB_CREATED, endedAt: null })
    expect(tx.eras.filter((e: FakeEra) => e.endedAt === null)).toHaveLength(1)
  })

  it("is idempotent - a second call does not open a second era", async () => {
    const tx = makeTx()
    const first = await ensureBotEra(tx, TEAM, CLUB_CREATED)
    const second = await ensureBotEra(tx, TEAM, CLUB_CREATED)

    expect(second.id).toBe(first.id)
    expect(tx.eras).toHaveLength(1)
  })
})

describe("human takeover", () => {
  it("closes the BOT era and opens a HUMAN era at the same instant", async () => {
    const tx = makeTx()
    await ensureBotEra(tx, TEAM, CLUB_CREATED)
    await recordHumanTakeover(tx, { teamId: TEAM, userId: USER, at: TAKEOVER })

    const [botEra, humanEra] = tx.eras as FakeEra[]
    expect(botEra).toMatchObject({ type: "BOT", userId: null, startedAt: CLUB_CREATED, endedAt: TAKEOVER })
    expect(humanEra).toMatchObject({ type: "HUMAN", userId: USER, startedAt: TAKEOVER, endedAt: null })
    // Gapless and non-overlapping: the boundary is a single instant.
    expect(botEra.endedAt!.getTime()).toBe(humanEra.startedAt.getTime())
  })

  it("closes before it opens - the order the per-statement unique index requires", async () => {
    const tx = makeTx()
    await ensureBotEra(tx, TEAM, CLUB_CREATED)
    tx.calls.length = 0
    await recordHumanTakeover(tx, { teamId: TEAM, userId: USER, at: TAKEOVER })

    expect(tx.calls.indexOf("closeEra")).toBeLessThan(tx.calls.indexOf("createEra"))
  })

  it("leaves exactly one open era afterwards", async () => {
    const tx = makeTx()
    await ensureBotEra(tx, TEAM, CLUB_CREATED)
    await recordHumanTakeover(tx, { teamId: TEAM, userId: USER, at: TAKEOVER })

    expect(tx.eras.filter((e: FakeEra) => e.endedAt === null)).toHaveLength(1)
    expect(tx.eras).toHaveLength(2)
  })

  it("two simultaneous takeovers cannot both claim the club - the second is rejected by the index", async () => {
    // Simulates the interleaving the Team row lock exists to prevent: both
    // callers read the same open bot era, then both try to insert. Even with
    // the lock defeated, the database refuses the second open era.
    const tx = makeTx()
    await ensureBotEra(tx, TEAM, CLUB_CREATED)

    // First takeover completes.
    await recordHumanTakeover(tx, { teamId: TEAM, userId: USER, at: TAKEOVER })
    // Second caller, holding a stale view, tries to open another human era
    // without closing the one now open.
    await expect(
      tx.teamEra.create({ data: { teamId: TEAM, userId: "user-2", type: "HUMAN", startedAt: TAKEOVER } })
    ).rejects.toMatchObject({ code: "P2002" })

    expect(tx.eras.filter((e: FakeEra) => e.endedAt === null)).toHaveLength(1)
    expect((tx.eras as FakeEra[]).find((e) => e.endedAt === null)!.userId).toBe(USER)
  })

  it("refuses to open an era that starts before the one it closes", async () => {
    const tx = makeTx()
    await ensureBotEra(tx, TEAM, TAKEOVER)
    await expect(
      closeEraAndOpenNext(tx, { teamId: TEAM, userId: USER, type: "HUMAN", at: CLUB_CREATED })
    ).rejects.toBeInstanceOf(TeamEraError)
    // Nothing was written: the bot era is untouched and still open.
    expect(tx.eras).toHaveLength(1)
    expect((tx.eras as FakeEra[])[0].endedAt).toBeNull()
  })

  it("opening a club's first era with none open is allowed, not an error", async () => {
    const tx = makeTx()
    const era = await closeEraAndOpenNext(tx, { teamId: TEAM, userId: USER, type: "HUMAN", at: CLUB_CREATED })
    expect(era).toMatchObject({ type: "HUMAN", endedAt: null })
    expect(tx.teamEra.update).not.toHaveBeenCalled()
  })
})
