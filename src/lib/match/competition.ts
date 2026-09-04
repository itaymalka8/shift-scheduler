/**
 * WHICH COMPETITION A FIXTURE BELONGS TO, AND WHAT THAT MEANS FOR THE MATCH.
 *
 * This module exists because of one line. Phase 2C keyed neutral venue,
 * neutral finances AND the penalty shootout off a single equality -
 * `fixture.stage === "TITLE_DECIDER"` - and the Phase 2D audit identified it
 * as the highest-risk location in the whole feature: add a stage value and
 * forget to widen that equality, and a championship playoff match silently
 * gets home advantage, a home crowd and league gate receipts, with no error
 * anywhere. Only a wrong champion.
 *
 * So the question is asked ONCE, by name, in one place.
 *
 * The rule is CLOSED BY CONSTRUCTION: anything that is not the league is a
 * neutral championship match. A future PROMOTION_PLAYOFF or
 * RELEGATION_PLAYOFF value is therefore neutral on the day it is added,
 * rather than on the day somebody remembers to update a list.
 */
import type { FixtureStage } from "@/generated/prisma"

/**
 * Is this a neutral championship fixture - a two-club title decider, or any
 * fixture of a multi-club championship playoff?
 *
 * True for everything that is not LEAGUE. Deliberately written as "not the
 * league" rather than as a list of the stages that happen to exist today.
 */
export function isNeutralCompetitionFixture(stage: FixtureStage): boolean {
  return stage !== "LEAGUE"
}

/**
 * Is this fixture played on neutral turf, with neither club at home?
 *
 * Home advantage in the engine is exactly two things and both are gated on
 * this: the flat homeAdvantage multiplier and the home crowd effect.
 */
export function isNeutralVenue(stage: FixtureStage): boolean {
  return isNeutralCompetitionFixture(stage)
}

/**
 * Does this fixture record NO club finances at all?
 *
 * League economics are asymmetric by design - the home club takes the gate
 * and pays to host, the away club pays to travel, and only the home crowd can
 * incur a fine. At a neutral ground every one of those would hand an
 * arbitrary advantage to whichever club happens to hold the technical home
 * role, which carries no sporting meaning. So a neutral fixture writes no
 * financial row at all - not a zero-valued one, which would still read in a
 * club's ledger as a match day that earned nothing.
 */
export function hasNeutralFinances(stage: FixtureStage): boolean {
  return isNeutralCompetitionFixture(stage)
}

/**
 * May this fixture go to a penalty shootout when the 90 minutes are level?
 *
 * A league match may end drawn and does. A championship match may not: the
 * whole reason these stages exist is to produce a winner.
 */
export function canGoToShootout(stage: FixtureStage): boolean {
  return isNeutralCompetitionFixture(stage)
}
