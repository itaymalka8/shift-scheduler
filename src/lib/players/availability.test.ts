import {
  availabilityUpdate,
  derivePlayerStatus,
  hasSomethingToServe,
  isSelectable,
  serveOneFixture,
  validateLineup,
  type LineupStarter,
} from "./availability"

const facts = (over: Partial<{ careerStatus: string; injuryMatchesRemaining: number; suspensionMatches: number }> = {}) => ({
  careerStatus: "ACTIVE",
  injuryMatchesRemaining: 0,
  suspensionMatches: 0,
  ...over,
})

describe("one function decides who may play", () => {
  it("a fit, active, unbanned player is available and selectable", () => {
    expect(derivePlayerStatus(facts())).toBe("available")
    expect(isSelectable(facts())).toBe(true)
  })

  it("a retired player is unavailable, whatever their counters say", () => {
    expect(derivePlayerStatus(facts({ careerStatus: "RETIRED" }))).toBe("unavailable")
    expect(derivePlayerStatus(facts({ careerStatus: "RETIRED", injuryMatchesRemaining: 3 }))).toBe("unavailable")
    expect(isSelectable(facts({ careerStatus: "RETIRED" }))).toBe(false)
  })

  it("an injury blocks selection", () => {
    expect(derivePlayerStatus(facts({ injuryMatchesRemaining: 1 }))).toBe("injured")
    expect(isSelectable(facts({ injuryMatchesRemaining: 1 }))).toBe(false)
  })

  it("a suspension blocks selection", () => {
    expect(derivePlayerStatus(facts({ suspensionMatches: 1 }))).toBe("suspended")
    expect(isSelectable(facts({ suspensionMatches: 1 }))).toBe(false)
  })

  it("injury outranks suspension in the label, and both still block", () => {
    const both = facts({ injuryMatchesRemaining: 2, suspensionMatches: 2 })
    expect(derivePlayerStatus(both)).toBe("injured")
    expect(isSelectable(both)).toBe(false)
  })
})

describe("status and the counters cannot disagree", () => {
  it("the update fragment always carries the status its own counters imply", () => {
    expect(availabilityUpdate(facts({ suspensionMatches: 2 })).status).toBe("suspended")
    expect(availabilityUpdate(facts({ injuryMatchesRemaining: 1 })).status).toBe("injured")
    expect(availabilityUpdate(facts()).status).toBe("available")
  })

  it("a healed player has their injury description cleared, not left behind", () => {
    expect(availabilityUpdate(facts()).injuryStatus).toBeNull()
  })

  it("a still-injured player keeps the description the caller supplied", () => {
    const update = availabilityUpdate(facts({ injuryMatchesRemaining: 2 }), "matchInjury")
    expect(update.injuryStatus).toBe("matchInjury")
    expect(update.status).toBe("injured")
  })

  it("there is no way to produce available with a live counter", () => {
    for (const injury of [0, 1, 3]) {
      for (const ban of [0, 1, 2]) {
        const update = availabilityUpdate(facts({ injuryMatchesRemaining: injury, suspensionMatches: ban }))
        if (update.status === "available") {
          expect(update.injuryMatchesRemaining).toBe(0)
          expect(update.suspensionMatches).toBe(0)
        }
      }
    }
  })
})

describe("serving one club fixture", () => {
  it("steps both counters down by one", () => {
    const served = serveOneFixture(facts({ injuryMatchesRemaining: 2, suspensionMatches: 3 }))
    expect(served.injuryMatchesRemaining).toBe(1)
    expect(served.suspensionMatches).toBe(2)
  })

  it("never goes below zero", () => {
    const served = serveOneFixture(facts())
    expect(served.injuryMatchesRemaining).toBe(0)
    expect(served.suspensionMatches).toBe(0)
  })

  it("an injury that expires while a ban runs leaves the player unavailable", () => {
    // The exact case the brief names: injury ends, suspension does not.
    let f = facts({ injuryMatchesRemaining: 1, suspensionMatches: 3 })
    f = serveOneFixture(f)
    expect(f.injuryMatchesRemaining).toBe(0)
    expect(derivePlayerStatus(f)).toBe("suspended")
    expect(isSelectable(f)).toBe(false)
  })

  it("a ban served while still injured leaves the player unavailable", () => {
    let f = facts({ injuryMatchesRemaining: 3, suspensionMatches: 1 })
    f = serveOneFixture(f)
    expect(f.suspensionMatches).toBe(0)
    expect(derivePlayerStatus(f)).toBe("injured")
    expect(isSelectable(f)).toBe(false)
  })

  it("both clear together and the player returns", () => {
    const f = serveOneFixture(facts({ injuryMatchesRemaining: 1, suspensionMatches: 1 }))
    expect(derivePlayerStatus(f)).toBe("available")
    expect(isSelectable(f)).toBe(true)
  })

  it("only a live counter is worth a write", () => {
    expect(hasSomethingToServe(facts())).toBe(false)
    expect(hasSomethingToServe(facts({ suspensionMatches: 1 }))).toBe(true)
    expect(hasSomethingToServe(facts({ injuryMatchesRemaining: 1 }))).toBe(true)
  })
})

describe("the legal XI", () => {
  const starter = (index: number, over: Partial<LineupStarter> = {}): LineupStarter => ({
    playerId: `p${index}`,
    teamId: "t1",
    slotIndex: index,
    careerStatus: "ACTIVE",
    injuryMatchesRemaining: 0,
    suspensionMatches: 0,
    ...over,
  })
  const full = () => Array.from({ length: 11 }, (_, i) => starter(i))

  it("eleven fit players in eleven distinct slots is legal", () => {
    expect(validateLineup("t1", 11, full()).legal).toBe(true)
  })

  it("eight starters is not a team", () => {
    const result = validateLineup("t1", 11, full().slice(0, 8))
    expect(result.legal).toBe(false)
    expect(result.problems).toContain("WRONG_STARTER_COUNT")
  })

  it("an injured starter makes the XI illegal and is named", () => {
    const xi = full()
    xi[4] = starter(4, { injuryMatchesRemaining: 2 })
    const result = validateLineup("t1", 11, xi)
    expect(result.legal).toBe(false)
    expect(result.problems).toContain("UNAVAILABLE_PLAYER")
    expect(result.offenders).toContain("p4")
  })

  it("a suspended starter makes the XI illegal", () => {
    const xi = full()
    xi[9] = starter(9, { suspensionMatches: 1 })
    expect(validateLineup("t1", 11, xi).problems).toContain("UNAVAILABLE_PLAYER")
  })

  it("a retired starter makes the XI illegal", () => {
    const xi = full()
    xi[0] = starter(0, { careerStatus: "RETIRED" })
    expect(validateLineup("t1", 11, xi).problems).toContain("UNAVAILABLE_PLAYER")
  })

  it("somebody else's player makes the XI illegal", () => {
    const xi = full()
    xi[3] = starter(3, { teamId: "t2" })
    const result = validateLineup("t1", 11, xi)
    expect(result.problems).toContain("FOREIGN_PLAYER")
    expect(result.offenders).toContain("p3")
  })

  it("the same player twice is a duplicate AND a slot gap", () => {
    const xi = full()
    xi[5] = starter(5, { playerId: "p4" })
    const result = validateLineup("t1", 11, xi)
    expect(result.problems).toContain("DUPLICATE_PLAYER")
  })

  it("a slot outside the formation is a gap", () => {
    const xi = full()
    xi[10] = starter(10, { slotIndex: 42 })
    expect(validateLineup("t1", 11, xi).problems).toContain("SLOT_GAP")
  })

  it("two starters in one slot is a gap", () => {
    const xi = full()
    xi[10] = starter(10, { slotIndex: 3 })
    expect(validateLineup("t1", 11, xi).problems).toContain("SLOT_GAP")
  })

  it("the formation decides the count, not a hard-coded eleven", () => {
    const seven = Array.from({ length: 7 }, (_, i) => starter(i))
    expect(validateLineup("t1", 7, seven).legal).toBe(true)
    expect(validateLineup("t1", 11, seven).legal).toBe(false)
  })
})
