/**
 * THE ACKNOWLEDGED LEDGER RESIDUE, AND THE RULE ABOUT NEW ONES.
 *
 * FinancialTransaction has no foreign key to Fixture - the link is the
 * referenceId string alone - so a deleted fixture can leave money rows behind.
 * Production carries exactly one such case: fixture cmtedbpib0001ya9jpzjzevb5
 * is gone and three rows referencing it remain, netting +213,629.
 *
 * TWO THINGS MUST STAY TRUE, and they pull in opposite directions, which is
 * why they are asserted separately:
 *
 *   1. THE KNOWN RESIDUE IS NEVER "FIXED". Economic balancing must not rewrite
 *      historical money. Those rows are part of how today's balances came to
 *      be; deleting or reversing them would silently move a club's balance to
 *      match a story we prefer over the one that happened.
 *
 *   2. A NEW ONE FAILS THE AUDIT. If a second orphan ever appears, a fixture is
 *      being deleted somewhere it should not be - and the difference between
 *      "known residue" and "something is deleting history" must not be a
 *      judgement call made by whoever reads the log.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..", "..", "..")
const AUDIT = readFileSync(join(ROOT, "scripts", "production", "economy-audit.ts"), "utf8")

describe("the acknowledged orphan", () => {
  it("is named in the audit, so the audit can tell it from a new one", () => {
    expect(AUDIT).toContain("cmtedbpib0001ya9jpzjzevb5")
    expect(AUDIT).toContain("ACKNOWLEDGED_ORPHAN_FIXTURE_IDS")
  })

  it("is exactly one id - a growing allow-list would be the defect, not the fix", () => {
    const declaration = AUDIT.slice(
      AUDIT.indexOf("const ACKNOWLEDGED_ORPHAN_FIXTURE_IDS"),
      AUDIT.indexOf("\n", AUDIT.indexOf("const ACKNOWLEDGED_ORPHAN_FIXTURE_IDS"))
    )
    expect(declaration.match(/"[a-z0-9]+"/g) ?? []).toHaveLength(1)
  })

  it("is never deleted, reversed or repaired by the audit", () => {
    // The audit reads the ledger and reports. It has no write path at all, and
    // certainly not one aimed at this.
    expect(AUDIT).not.toContain("financialTransaction.delete")
    expect(AUDIT).not.toContain("financialTransaction.update")
    expect(AUDIT).not.toContain("financialTransaction.create")
  })
})

describe("a new orphan fails the run", () => {
  it("is computed as the difference from the acknowledged set, not merely counted", () => {
    expect(AUDIT).toContain("const unexpectedOrphans = orphanFixtureIds.filter")
    expect(AUDIT).toContain("!ACKNOWLEDGED_ORPHAN_FIXTURE_IDS.includes(id)")
  })

  it("pushes an audit failure rather than printing a note", () => {
    const section = AUDIT.slice(AUDIT.indexOf("const unexpectedOrphans"))
    expect(section).toContain("if (unexpectedOrphans.length > 0) {")
    expect(section).toContain("phase3rFailures.push(")
  })

  it("and an audit failure actually fails the process", () => {
    expect(AUDIT).toContain("if (phase3rFailures.length > 0) {")
    expect(AUDIT).toContain("process.exitCode = 1")
  })
})
