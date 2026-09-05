/**
 * ONE SHAPE FOR A CHAMPIONSHIP, read the same way by both cabinets.
 *
 * The manager cabinet and the club cabinet ask different questions - "which
 * titles are this person's" versus "which titles are this club's" - but they
 * are looking at the same rows, so the SELECT and the mapping live here once.
 * Two copies would eventually disagree about provenance, which is the part
 * that is easiest to get subtly wrong.
 *
 * SeasonChampion IS THE AUTHORITY. Nothing here recomputes a standings table,
 * re-derives a winner from fixtures, or consults current ownership. The row
 * says who won; this module only says how it was won and what to call the
 * club.
 */
import type { FixtureStage, PlayoffPhase } from "@/generated/prisma"
import { isMatchFinished } from "@/lib/match/timing"

/**
 * How a title was settled.
 *
 * Derived from the deciding fixture's stage, never stored twice: a
 * championship with no deciding fixture was won on the league table, which is
 * the ordinary case and needs no marker of its own.
 */
export type ChampionshipDecision = "TABLE" | "DECIDER" | "PLAYOFF"

/** Everything both cabinets need, and nothing either of them does not. */
export const CHAMPIONSHIP_SELECT = {
  id: true,
  teamId: true,
  teamEraId: true,
  decidedAt: true,
  decidedByFixtureId: true,
  clubNameAtDecision: true,
  season: { select: { number: true, countryCode: true } },
  division: { select: { tier: true, group: true, name: true } },
  team: {
    select: {
      id: true,
      name: true,
      crestShape: true,
      crestPattern: true,
      crestIcon: true,
      crestColor: true,
      crestSecondaryColor: true,
      crestBorderColor: true,
      crestImageUrl: true,
    },
  },
  decidedByFixture: {
    select: {
      id: true,
      stage: true,
      playoffId: true,
      playoffPhase: true,
      playoffRound: true,
      scheduledAt: true,
      playedAt: true,
      homeTeamId: true,
      awayTeamId: true,
      homeShootoutScore: true,
      awayShootoutScore: true,
    },
  },
} as const

export interface ChampionshipCrest {
  shape: string | null
  pattern: string | null
  icon: string | null
  color: string | null
  secondaryColor: string | null
  borderColor: string | null
  imageUrl: string | null
}

export interface ChampionshipView {
  id: string
  seasonNumber: number
  countryCode: string
  divisionTier: number
  divisionGroup: string | null
  divisionName: string
  /** THE identity of the champion club. Never the name. */
  teamId: string
  /**
   * What to print. The historical snapshot when there is one, otherwise the
   * club's CURRENT name - and `clubNameIsHistorical` says which, so the UI can
   * be honest about it rather than passing a fallback off as a record.
   */
  clubName: string
  clubNameIsHistorical: boolean
  crest: ChampionshipCrest
  decidedAt: Date
  teamEraId: string | null
  decidedByFixtureId: string | null
  decision: ChampionshipDecision
  playoffPhase: "ROUND_ROBIN" | "KNOCKOUT" | null
  playoffRound: number | null
  /** Penalties, when the deciding match needed them. Null otherwise. */
  shootout: { home: number; away: number; winnerTeamId: string } | null
}

type ChampionshipRow = {
  id: string
  teamId: string
  teamEraId: string | null
  decidedAt: Date
  decidedByFixtureId: string | null
  clubNameAtDecision: string | null
  season: { number: number; countryCode: string }
  division: { tier: number; group: string | null; name: string }
  team: {
    id: string
    name: string
    crestShape: string | null
    crestPattern: string | null
    crestIcon: string | null
    crestColor: string | null
    crestSecondaryColor: string | null
    crestBorderColor: string | null
    crestImageUrl: string | null
  }
  decidedByFixture: {
    id: string
    // The enum itself, not a hand-copied union. Phase 3Q added
    // BOUNDARY_DECIDER and PROMOTION_PLAYOFF, and a frozen list here would
    // have needed editing for every future competition - which is the drift
    // this file's own "derive, never duplicate" rule exists to prevent. A
    // title is still only ever decided by LEAGUE, TITLE_DECIDER or
    // TITLE_PLAYOFF; that is enforced where titles are resolved, not by
    // narrowing a display type.
    stage: FixtureStage
    playoffId: string | null
    playoffPhase: PlayoffPhase | null
    playoffRound: number | null
    scheduledAt: Date | null
    playedAt: Date | null
    homeTeamId: string
    awayTeamId: string
    homeShootoutScore: number | null
    awayShootoutScore: number | null
  } | null
}

/**
 * One stored championship, as a cabinet renders it.
 *
 * `now` is a parameter so a page renders every card from one instant, the
 * same discipline the record and Match Center code follow.
 */
export function toChampionshipView(row: ChampionshipRow, now: Date = new Date()): ChampionshipView {
  const fixture = row.decidedByFixture

  const decision: ChampionshipDecision =
    fixture === null
      ? "TABLE"
      : fixture.stage === "TITLE_PLAYOFF"
        ? "PLAYOFF"
        : fixture.stage === "TITLE_DECIDER"
          ? "DECIDER"
          : // A LEAGUE fixture as the decider means the title was settled by
            // the table on that match's kickoff - which is what decidedAt
            // records. Still a table championship.
            "TABLE"

  // The shootout is a result, so it obeys the project's one finished-match
  // rule rather than being trusted because the row exists. A title is only
  // written after its decider finished, so this can only ever fail closed on
  // broken data - which is exactly when it should.
  const settled = fixture !== null && isMatchFinished(fixture.scheduledAt, now) && fixture.playedAt !== null
  const shootout =
    settled &&
    fixture !== null &&
    fixture.homeShootoutScore !== null &&
    fixture.awayShootoutScore !== null &&
    fixture.homeShootoutScore !== fixture.awayShootoutScore
      ? {
          home: fixture.homeShootoutScore,
          away: fixture.awayShootoutScore,
          winnerTeamId:
            fixture.homeShootoutScore > fixture.awayShootoutScore ? fixture.homeTeamId : fixture.awayTeamId,
        }
      : null

  return {
    id: row.id,
    seasonNumber: row.season.number,
    countryCode: row.season.countryCode,
    divisionTier: row.division.tier,
    divisionGroup: row.division.group,
    divisionName: row.division.name,
    teamId: row.teamId,
    // The snapshot is the historical label. Team.name is a PRESENTATION
    // fallback for a row written before the snapshot existed - flagged as
    // such, never passed off as the name the title was won under.
    clubName: row.clubNameAtDecision ?? row.team.name,
    clubNameIsHistorical: row.clubNameAtDecision !== null,
    crest: {
      shape: row.team.crestShape,
      pattern: row.team.crestPattern,
      icon: row.team.crestIcon,
      color: row.team.crestColor,
      secondaryColor: row.team.crestSecondaryColor,
      borderColor: row.team.crestBorderColor,
      imageUrl: row.team.crestImageUrl,
    },
    decidedAt: row.decidedAt,
    teamEraId: row.teamEraId,
    decidedByFixtureId: row.decidedByFixtureId,
    decision,
    playoffPhase: fixture?.playoffPhase ?? null,
    playoffRound: fixture?.playoffRound ?? null,
    shootout,
  }
}

/** Most recent first. decidedAt, not season number - two countries share numbers. */
export function byMostRecent(a: ChampionshipView, b: ChampionshipView): number {
  return b.decidedAt.getTime() - a.decidedAt.getTime()
}
