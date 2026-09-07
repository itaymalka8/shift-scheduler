import { planTeamEraBackfill, planHasExactlyOneOpenEraPerTeam, type BackfillTeamInput } from "./backfill-eras"

const CLUB_CREATED = new Date("2026-08-01T00:00:00.000Z")
const USER_CREATED = new Date("2026-09-05T12:00:00.000Z")

function team(overrides: Partial<BackfillTeamInput> = {}): BackfillTeamInput {
  return {
    id: "team-1",
    isBot: true,
    createdAt: CLUB_CREATED,
    userId: null,
    userCreatedAt: null,
    existingEraCount: 0,
    ...overrides,
  }
}

describe("planTeamEraBackfill", () => {
  it("gives a still-bot club one open BOT era from its own createdAt", () => {
    const plan = planTeamEraBackfill([team()])
    expect(plan.eras).toEqual([
      { teamId: "team-1", userId: null, type: "BOT", startedAt: CLUB_CREATED, endedAt: null },
    ])
    expect(plan.unresolved).toEqual([])
  })

  it("splits a TAKEN-OVER club into a closed BOT era and an open HUMAN era", () => {
    // The club predates its owner: it was seeded as a bot and later claimed.
    const plan = planTeamEraBackfill([
      team({ isBot: false, userId: "user-1", userCreatedAt: USER_CREATED }),
    ])

    expect(plan.eras).toEqual([
      { teamId: "team-1", userId: null, type: "BOT", startedAt: CLUB_CREATED, endedAt: USER_CREATED },
      { teamId: "team-1", userId: "user-1", type: "HUMAN", startedAt: USER_CREATED, endedAt: null },
    ])
    // Gapless: the bot era ends exactly where the human era begins.
    expect(plan.eras[0].endedAt).toEqual(plan.eras[1].startedAt)
  })

  it("gives a BORN-HUMAN club a single open HUMAN era - it never had a bot phase", () => {
    // An OAuth signup (or a credential signup with no free bot slot) creates
    // its club after the user, inside the user's own transaction.
    const plan = planTeamEraBackfill([
      team({ isBot: false, createdAt: USER_CREATED, userId: "user-1", userCreatedAt: CLUB_CREATED }),
    ])
    expect(plan.eras).toEqual([
      { teamId: "team-1", userId: "user-1", type: "HUMAN", startedAt: USER_CREATED, endedAt: null },
    ])
  })

  it("treats a club created at the same instant as its user as born human, not taken over", () => {
    const plan = planTeamEraBackfill([
      team({ isBot: false, createdAt: USER_CREATED, userId: "user-1", userCreatedAt: USER_CREATED }),
    ])
    expect(plan.eras).toHaveLength(1)
    expect(plan.eras[0].type).toBe("HUMAN")
  })

  it("REFUSES TO GUESS about a club that is both a bot and owned", () => {
    const plan = planTeamEraBackfill([team({ isBot: true, userId: "user-1", userCreatedAt: USER_CREATED })])
    expect(plan.eras).toEqual([])
    expect(plan.unresolved).toHaveLength(1)
    expect(plan.unresolved[0].teamId).toBe("team-1")
    expect(plan.unresolved[0].reason).toContain("isBot = true but userId is set")
  })

  it("REFUSES TO GUESS about an owned club whose user row could not be read", () => {
    const plan = planTeamEraBackfill([team({ isBot: false, userId: "user-1", userCreatedAt: null })])
    expect(plan.eras).toEqual([])
    expect(plan.unresolved).toHaveLength(1)
  })

  it("REFUSES TO GUESS about an unowned non-bot club", () => {
    const plan = planTeamEraBackfill([team({ isBot: false, userId: null })])
    expect(plan.eras).toEqual([])
    expect(plan.unresolved).toHaveLength(1)
  })

  it("is idempotent: a club that already has eras is skipped entirely", () => {
    const plan = planTeamEraBackfill([
      team({ existingEraCount: 1 }),
      team({ id: "team-2", isBot: false, userId: "user-2", userCreatedAt: USER_CREATED, existingEraCount: 2 }),
    ])
    expect(plan.eras).toEqual([])
    expect(plan.skippedAlreadyHasEras).toEqual(["team-1", "team-2"])
  })

  it("running the plan twice produces nothing the second time", () => {
    const teams = [
      team(),
      team({ id: "team-2", isBot: false, userId: "user-2", userCreatedAt: USER_CREATED }),
    ]
    const first = planTeamEraBackfill(teams)
    expect(first.eras.length).toBeGreaterThan(0)

    // After applying, every club now has eras.
    const afterApply = teams.map((t) => ({
      ...t,
      existingEraCount: first.eras.filter((e) => e.teamId === t.id).length,
    }))
    const second = planTeamEraBackfill(afterApply)
    expect(second.eras).toEqual([])
    expect(second.unresolved).toEqual([])
  })

  it("every club it plans for ends with exactly one open era", () => {
    const plan = planTeamEraBackfill([
      team(),
      team({ id: "team-2", isBot: false, userId: "user-2", userCreatedAt: USER_CREATED }),
      team({ id: "team-3", isBot: false, createdAt: USER_CREATED, userId: "user-3", userCreatedAt: CLUB_CREATED }),
    ])
    expect(planHasExactlyOneOpenEraPerTeam(plan)).toBe(true)
  })
})

describe("the shapes the initial migration must produce", () => {
  // The migration's four INSERT statements encode exactly these rules. This
  // asserts the rules themselves; the SQL was separately replayed against a
  // real Postgres over the same shapes and produced the identical rows.
  const CASES: { name: string; team: BackfillTeamInput; expected: { type: string; open: boolean }[] }[] = [
    { name: "still a bot", team: team(), expected: [{ type: "BOT", open: true }] },
    {
      name: "taken over",
      team: team({ isBot: false, userId: "user-1", userCreatedAt: USER_CREATED }),
      expected: [
        { type: "BOT", open: false },
        { type: "HUMAN", open: true },
      ],
    },
    {
      name: "born human",
      team: team({ isBot: false, createdAt: USER_CREATED, userId: "user-1", userCreatedAt: CLUB_CREATED }),
      expected: [{ type: "HUMAN", open: true }],
    },
    { name: "anomaly: bot but owned", team: team({ userId: "user-1", userCreatedAt: USER_CREATED }), expected: [] },
    { name: "anomaly: not a bot, unowned", team: team({ isBot: false }), expected: [] },
  ]

  it.each(CASES)("$name", ({ team: input, expected }) => {
    const plan = planTeamEraBackfill([input])
    expect(plan.eras.map((e) => ({ type: e.type, open: e.endedAt === null }))).toEqual(expected)
  })

  it("no club ever receives two open eras from the plan", () => {
    const plan = planTeamEraBackfill(CASES.map((c, i) => ({ ...c.team, id: `team-${i}` })))
    const openPerTeam = new Map<string, number>()
    for (const era of plan.eras) {
      if (era.endedAt === null) openPerTeam.set(era.teamId, (openPerTeam.get(era.teamId) ?? 0) + 1)
    }
    expect([...openPerTeam.values()].every((n) => n === 1)).toBe(true)
    expect(planHasExactlyOneOpenEraPerTeam(plan)).toBe(true)
  })

  it("the two anomaly shapes are the only ones that produce no era", () => {
    const plan = planTeamEraBackfill(CASES.map((c, i) => ({ ...c.team, id: `team-${i}` })))
    expect(plan.unresolved).toHaveLength(2)
  })
})
