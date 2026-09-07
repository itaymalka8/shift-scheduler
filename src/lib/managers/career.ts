/**
 * A MANAGER'S CAREER, aggregated from eras.
 *
 * Pure: no database, no clock of its own. Every function takes what it needs
 * and `now` is always a parameter, so a whole profile page is derived from one
 * instant rather than from a clock that moves between calls.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE. A career is a SUM OF ERAS, never a
 * span. Two spells at one club are two rows with a bot era between them, and
 * the tempting shortcut - treat the club as one window from the first
 * startedAt to the last endedAt - silently absorbs every match the bot played
 * in between. There is a test that computes it both ways and asserts they
 * differ, so anyone who reaches for the shortcut later fails a test that
 * explains why.
 *
 * Nothing here reads Team.userId, Team.isBot or Team.name. A career is
 * TeamEra rows and finished fixtures; current ownership is a different
 * question with a different answer.
 */
import {
  EMPTY_MANAGER_RECORD,
  computeManagerRecord,
  type EraWindow,
  type FixtureResult,
  type ManagerRecord,
} from "@/lib/teams/era"

/** One HUMAN era, as the career layer needs it. Type is not carried: only HUMAN eras ever reach here. */
export interface CareerEra {
  id: string
  teamId: string
  startedAt: Date
  endedAt: Date | null
  startedSeason: { number: number; countryCode: string } | null
  endedSeason: { number: number; countryCode: string } | null
}

/** One spell in charge of one club, with what happened during it. */
export interface CareerSpell extends CareerEra {
  record: ManagerRecord
  /** Titles whose SeasonChampion.teamEraId points at THIS era. */
  championships: number
  /** True for the open era - the club the manager holds right now. */
  isCurrent: boolean
}

export interface CareerSummary {
  record: ManagerRecord
  /** wins / matches, or null when no match has been played. Never stored. */
  winPercentage: number | null
  /** DISTINCT clubs. Two spells at one club is one club. */
  clubsManaged: number
  /** Spells, which is the number of eras - two spells at one club is two. */
  spells: number
  /** The first era's start. Not User.createdAt: registering is not managing. */
  careerStartedAt: Date | null
  championships: number
}

/** Adds records without caring where they came from. */
export function sumRecords(records: ManagerRecord[]): ManagerRecord {
  return records.reduce(
    (total, r) => ({
      matches: total.matches + r.matches,
      wins: total.wins + r.wins,
      draws: total.draws + r.draws,
      losses: total.losses + r.losses,
      goalsFor: total.goalsFor + r.goalsFor,
      goalsAgainst: total.goalsAgainst + r.goalsAgainst,
    }),
    { ...EMPTY_MANAGER_RECORD }
  )
}

/**
 * Wins as a share of matches, or null when there are none.
 *
 * Null rather than 0: a manager who has not played is not a 0% manager, and
 * the UI shows a dash. Derived on every render and never persisted - a stored
 * percentage is a second source of truth for a division.
 */
export function winPercentage(record: ManagerRecord): number | null {
  if (record.matches === 0) return null
  return record.wins / record.matches
}

/** The era window shape the canonical attribution rule works on. */
function toWindow(era: CareerEra): EraWindow {
  return { teamId: era.teamId, startedAt: era.startedAt, endedAt: era.endedAt }
}

/**
 * One spell per era, in chronological order.
 *
 * Each era is measured INDEPENDENTLY against the same fixture list, by
 * computeManagerRecord - the project's one attribution rule. Fixtures outside
 * an era's half-open window, or belonging to another club, or not finished,
 * are skipped by that function rather than by anything written here.
 */
export function buildCareerSpells(
  eras: CareerEra[],
  fixtures: FixtureResult[],
  championshipsByEraId: Map<string, number>,
  now: Date
): CareerSpell[] {
  return [...eras]
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    .map((era) => ({
      ...era,
      record: computeManagerRecord(toWindow(era), fixtures, now),
      championships: championshipsByEraId.get(era.id) ?? 0,
      isCurrent: era.endedAt === null,
    }))
}

/** Career totals: the sum of the spells, and nothing cleverer. */
export function summariseCareer(spells: CareerSpell[]): CareerSummary {
  const record = sumRecords(spells.map((s) => s.record))
  return {
    record,
    winPercentage: winPercentage(record),
    clubsManaged: new Set(spells.map((s) => s.teamId)).size,
    spells: spells.length,
    careerStartedAt: spells.length > 0 ? spells[0].startedAt : null,
    championships: spells.reduce((total, s) => total + s.championships, 0),
  }
}

/**
 * The club the manager holds right now, or null when they hold none.
 *
 * The OPEN era, and only that. Never Team.userId: that answers "who holds this
 * club" from the club's side, which is current state rather than career
 * history, and a profile that mixed the two would disagree with itself the
 * moment someone left.
 */
export function currentSpell(spells: CareerSpell[]): CareerSpell | null {
  return spells.find((spell) => spell.isCurrent) ?? null
}

/**
 * Everything the manager did at one club, across every separate spell.
 *
 * Summed per era. NOT computed from one window spanning the first start to
 * the last end - see this module's header for why that would be wrong.
 */
export function clubRecord(spells: CareerSpell[], teamId: string): ManagerRecord {
  return sumRecords(spells.filter((s) => s.teamId === teamId).map((s) => s.record))
}

/** The spells at one club, in order. Two spells stay two spells. */
export function spellsAtClub(spells: CareerSpell[], teamId: string): CareerSpell[] {
  return spells.filter((spell) => spell.teamId === teamId)
}
