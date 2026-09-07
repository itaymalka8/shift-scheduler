/**
 * THE HALL OF FAME, ranked. Pure: no Prisma, no clock of its own, no I/O.
 * `now` is always a parameter, so one instant measures the entire page and a
 * tenure cannot grow between two leaderboards on the same screen.
 *
 * A READ MODEL, NOT A SOURCE OF TRUTH. Every number here is derived from
 * TeamEra, SeasonChampion and Fixture rows the caller supplies. Nothing is
 * stored, nothing is cached, and there is no summary table behind it - so the
 * Hall of Fame can never disagree with a manager's own profile page, because
 * both are the same arithmetic over the same rows.
 *
 * WHY A HUMAN ERA MAP RATHER THAN A userId FILTER. Manager credit is decided
 * by whether a championship's teamEraId is present in `humanEras`, and the
 * reader only ever puts HUMAN eras in it. A bot title therefore cannot reach a
 * manager leaderboard by construction - not because a condition remembered to
 * exclude it, but because there is no key for it to match.
 *
 * TIES SHARE A RANK. 10, 10, 8 ranks as 1, 1, 3 - never 1, 2, 3. Nothing about
 * a person or a club breaks a sporting tie: not a name, not a locale collation,
 * not an id, not the order rows came back from the database. Inside a tied
 * group the entries are ordered by immutable id purely so the page renders the
 * same way twice; see rankEntries.
 */
import {
  computeManagerRecord,
  type EraWindow,
  type FixtureResult,
  type ManagerRecord,
} from "@/lib/teams/era"
import { sumRecords, winPercentage } from "@/lib/managers/career"

/**
 * The minimum completed matches before a win rate is ranked at all.
 *
 * 38 - one full league season. Without a floor the leaderboard is won by
 * whoever has managed a single match and happened to win it, which tells a
 * reader nothing about who is good at this. A manager below the floor is
 * absent from THIS leaderboard only; every other number of theirs still counts.
 */
export const MIN_MATCHES_FOR_WIN_RATE = 38

/** One HUMAN era, as the Hall of Fame needs it. Only HUMAN eras are ever passed in. */
export interface HallOfFameEra {
  id: string
  teamId: string
  /** Never null: a HUMAN era always names its manager (a database CHECK guarantees it). */
  userId: string
  startedAt: Date
  endedAt: Date | null
}

export interface HallOfFameManager {
  userId: string
  name: string | null
  image: string | null
}

export interface HallOfFameClub {
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

/** A championship, reduced to the two things that decide who it belongs to. */
export interface HallOfFameChampionship {
  /** The club that won it. Always credited, whoever was in charge. */
  teamId: string
  /** The era that won it, or null for a row that predates era tracking. */
  teamEraId: string | null
}

/**
 * One row of a leaderboard.
 *
 * `rank` is the SPORTING rank and is shared by ties. Position in the array is
 * a display detail and is not a rank - never render an index.
 */
export interface RankedEntry<T> {
  rank: number
  value: number
  entry: T
}

/**
 * Ranks by value, descending, with tied values sharing a rank.
 *
 * Standard competition ranking: after two firsts the next rank is 3, because a
 * rank answers "how many did better", and one person did not do better than
 * the other. The rank of an entry depends ONLY on its value.
 *
 * `displayKey` orders entries WITHIN a tied group. It exists so the page looks
 * the same on two renders, and it is an immutable id rather than a name for a
 * reason: a name-based order would read as a judgement about who came first,
 * and would move when someone renames themselves. IT CARRIES NO SPORTING
 * MEANING AND IT NEVER CHANGES A RANK. It is not a tie-breaker; the tie is not
 * broken.
 */
export function rankEntries<T>(items: T[], valueOf: (item: T) => number, displayKey: (item: T) => string): RankedEntry<T>[] {
  const sorted = [...items].sort((a, b) => {
    const byValue = valueOf(b) - valueOf(a)
    if (byValue !== 0) return byValue
    return displayKey(a).localeCompare(displayKey(b))
  })

  const ranked: RankedEntry<T>[] = []
  for (let i = 0; i < sorted.length; i++) {
    const value = valueOf(sorted[i])
    // Equal value means equal rank - and the rank of a new value is its
    // 1-based position, which is exactly "how many finished ahead, plus one".
    const rank = i > 0 && value === ranked[i - 1].value ? ranked[i - 1].rank : i + 1
    ranked.push({ rank, value, entry: sorted[i] })
  }
  return ranked
}

/**
 * A summarised rank group: a shared place too crowded to list row by row.
 */
export interface SharedPlace {
  rank: number
  value: number
  players: number
}

export interface BoardCut<T> {
  rows: RankedEntry<T>[]
  /**
   * Shared places that did not fit, described instead of listed. Never a
   * partial group: a rank is shown in full or summarised in full.
   */
  shared: SharedPlace[]
}

/**
 * The top of a board.
 *
 * A hall of fame board is a top-N list, and the player boards need one that
 * actually bounds the page. Two rules pull against each other here, and both
 * matter:
 *
 *   1. A TIE IS NEVER SPLIT. Everyone on the same figure holds the same rank,
 *      so cutting a board mid-group would use array position to prefer one of
 *      them - the exact thing sharing a rank means we do not do.
 *   2. THE PAGE IS BOUNDED. Rule 1 alone is not a bound: a tie can be
 *      arbitrarily wide. Production's appearance figures are currently
 *      IDENTICAL for 844 players, so "whole groups up to ten places" is 844
 *      rows, today, in practice.
 *
 * So groups are taken WHOLE while they fit inside `maxRows`, and a group that
 * would not fit is SUMMARISED rather than truncated - "1st, shared by 844
 * players on 2 appearances" is both bounded and true, where thirty arbitrary
 * names out of 844 would be neither.
 *
 * Once one group is summarised every later group is too: showing 2nd place in
 * full beneath a hidden 1st place would misrepresent the board.
 *
 * `ranked` is expected to arrive from rankEntries, already ranked and ordered.
 */
export function boardTop<T>(ranked: RankedEntry<T>[], places: number, maxRows: number): BoardCut<T> {
  const rows: RankedEntry<T>[] = []
  const shared: SharedPlace[] = []
  let summarising = false

  for (let i = 0; i < ranked.length; ) {
    const rank = ranked[i].rank
    if (rank > places) break

    let end = i
    while (end < ranked.length && ranked[end].rank === rank) end++
    const group = ranked.slice(i, end)

    if (!summarising && rows.length + group.length <= maxRows) {
      rows.push(...group)
    } else {
      summarising = true
      shared.push({ rank, value: group[0].value, players: group.length })
    }
    i = end
  }

  return { rows, shared }
}

// ---------------------------------------------------------------------------
// HONOURS
// ---------------------------------------------------------------------------

export interface ManagerChampionshipsEntry {
  manager: HallOfFameManager
}

/**
 * MOST CHAMPIONSHIPS BY MANAGER.
 *
 * SeasonChampion -> teamEraId -> a HUMAN era -> that era's userId. One row is
 * one championship. A title whose era is not in `humanEras` - a bot title, or
 * a row with no era at all - belongs to no manager and is counted by nobody.
 *
 * Managers with none are omitted rather than listed with 0: an honours board
 * lists honours.
 */
export function mostChampionshipsByManager(
  championships: HallOfFameChampionship[],
  humanEras: HallOfFameEra[],
  managers: Map<string, HallOfFameManager>
): RankedEntry<ManagerChampionshipsEntry>[] {
  const userIdByEraId = new Map(humanEras.map((era) => [era.id, era.userId]))
  const counts = new Map<string, number>()

  for (const championship of championships) {
    if (championship.teamEraId === null) continue
    const userId = userIdByEraId.get(championship.teamEraId)
    if (userId === undefined) continue // a BOT era, or an era we were not given
    counts.set(userId, (counts.get(userId) ?? 0) + 1)
  }

  const entries: { manager: HallOfFameManager; count: number }[] = []
  for (const [userId, count] of counts) {
    const manager = managers.get(userId)
    if (manager) entries.push({ manager, count })
  }

  return rankEntries(
    entries,
    (e) => e.count,
    (e) => e.manager.userId
  ).map((r) => ({ ...r, entry: { manager: r.entry.manager } }))
}

export interface ClubChampionshipsEntry {
  club: HallOfFameClub
}

/**
 * MOST CHAMPIONSHIPS BY CLUB.
 *
 * By teamId, which is the champion's identity. BOTH bot-era and human-era
 * titles count: a club's honours are the club's, and who was in the dugout is
 * a different question answered on a different page.
 */
export function mostChampionshipsByClub(
  championships: HallOfFameChampionship[],
  clubs: Map<string, HallOfFameClub>
): RankedEntry<ClubChampionshipsEntry>[] {
  const counts = new Map<string, number>()
  for (const championship of championships) {
    counts.set(championship.teamId, (counts.get(championship.teamId) ?? 0) + 1)
  }

  const entries: { club: HallOfFameClub; count: number }[] = []
  for (const [teamId, count] of counts) {
    const club = clubs.get(teamId)
    if (club) entries.push({ club, count })
  }

  return rankEntries(
    entries,
    (e) => e.count,
    (e) => e.club.id
  ).map((r) => ({ ...r, entry: { club: r.entry.club } }))
}

// ---------------------------------------------------------------------------
// PERFORMANCE
// ---------------------------------------------------------------------------

function toWindow(era: HallOfFameEra): EraWindow {
  return { teamId: era.teamId, startedAt: era.startedAt, endedAt: era.endedAt }
}

/**
 * Every manager's career record, keyed by userId.
 *
 * A CAREER IS THE SUM OF ITS ERAS. Each era is measured independently against
 * the same fixture list by computeManagerRecord - the project's one attribution
 * rule, reused rather than restated - and the results are added. Two spells at
 * one club are two measurements, so the bot interval between them is outside
 * both windows and enters neither.
 *
 * Live matches never arrive here (the reader does not select them) and would
 * be rejected anyway by countsTowardRecord inside computeManagerRecord.
 */
export function computeCareerRecords(
  humanEras: HallOfFameEra[],
  fixtures: FixtureResult[],
  now: Date
): Map<string, ManagerRecord> {
  const byUser = new Map<string, ManagerRecord[]>()
  for (const era of humanEras) {
    const record = computeManagerRecord(toWindow(era), fixtures, now)
    const list = byUser.get(era.userId)
    if (list) list.push(record)
    else byUser.set(era.userId, [record])
  }

  const records = new Map<string, ManagerRecord>()
  for (const [userId, list] of byUser) records.set(userId, sumRecords(list))
  return records
}

export interface ManagerRecordEntry {
  manager: HallOfFameManager
  record: ManagerRecord
}

/** MOST WINS, and MOST MATCHES MANAGED - the same records, ranked on a different column. */
export function mostWins(
  records: Map<string, ManagerRecord>,
  managers: Map<string, HallOfFameManager>
): RankedEntry<ManagerRecordEntry>[] {
  return rankManagerRecords(records, managers, (record) => record.wins)
}

export function mostMatches(
  records: Map<string, ManagerRecord>,
  managers: Map<string, HallOfFameManager>
): RankedEntry<ManagerRecordEntry>[] {
  return rankManagerRecords(records, managers, (record) => record.matches)
}

function rankManagerRecords(
  records: Map<string, ManagerRecord>,
  managers: Map<string, HallOfFameManager>,
  valueOf: (record: ManagerRecord) => number
): RankedEntry<ManagerRecordEntry>[] {
  const entries: ManagerRecordEntry[] = []
  for (const [userId, record] of records) {
    const manager = managers.get(userId)
    // A manager who has never completed a match is not on a performance board.
    if (manager && record.matches > 0) entries.push({ manager, record })
  }
  return rankEntries(
    entries,
    (e) => valueOf(e.record),
    (e) => e.manager.userId
  )
}

export interface WinRateEntry {
  manager: HallOfFameManager
  record: ManagerRecord
  /** wins / matches, in [0, 1]. Derived on every render, never stored. */
  winRate: number
}

/**
 * BEST WIN PERCENTAGE, among managers who have completed at least
 * MIN_MATCHES_FOR_WIN_RATE matches.
 *
 * The floor is applied BEFORE ranking, not as a display filter afterwards, so
 * a one-match manager cannot occupy rank 1 and then be hidden - they were
 * never in the running. Exactly 38 qualifies; 37 does not.
 */
export function bestWinRate(
  records: Map<string, ManagerRecord>,
  managers: Map<string, HallOfFameManager>,
  minimumMatches: number = MIN_MATCHES_FOR_WIN_RATE
): RankedEntry<WinRateEntry>[] {
  const entries: WinRateEntry[] = []
  for (const [userId, record] of records) {
    if (record.matches < minimumMatches) continue
    const manager = managers.get(userId)
    const rate = winPercentage(record)
    if (manager && rate !== null) entries.push({ manager, record, winRate: rate })
  }
  return rankEntries(
    entries,
    (e) => e.winRate,
    (e) => e.manager.userId
  )
}

// ---------------------------------------------------------------------------
// LONGEVITY
// ---------------------------------------------------------------------------

export interface TenureEntry {
  manager: HallOfFameManager
  club: HallOfFameClub
  eraId: string
  startedAt: Date
  endedAt: Date | null
  /** True while the spell is still running - its length is still growing. */
  ongoing: boolean
  durationMs: number
}

/**
 * LONGEST SINGLE CLUB TENURE - one entry per SPELL, not per manager.
 *
 * Each era is measured on its own. Two spells at the same club are NOT merged:
 * merging would hand a manager credit for the bot interval between them, which
 * is precisely the mistake the career layer exists to prevent, and it would
 * also be a different claim - "longest total time at a club" is not "longest
 * unbroken spell". A manager with two long spells legitimately appears twice.
 *
 * An open era is measured to `now`, the SAME `now` the whole page is built
 * from. The clock is never read here.
 */
export function longestTenures(
  humanEras: HallOfFameEra[],
  managers: Map<string, HallOfFameManager>,
  clubs: Map<string, HallOfFameClub>,
  now: Date
): RankedEntry<TenureEntry>[] {
  const entries: TenureEntry[] = []
  for (const era of humanEras) {
    const manager = managers.get(era.userId)
    const club = clubs.get(era.teamId)
    if (!manager || !club) continue
    const end = era.endedAt ?? now
    const durationMs = end.getTime() - era.startedAt.getTime()
    if (durationMs <= 0) continue
    entries.push({
      manager,
      club,
      eraId: era.id,
      startedAt: era.startedAt,
      endedAt: era.endedAt,
      ongoing: era.endedAt === null,
      durationMs,
    })
  }
  return rankEntries(
    entries,
    (e) => e.durationMs,
    (e) => e.eraId
  )
}

export interface ClubsManagedEntry {
  manager: HallOfFameManager
  clubs: number
}

/**
 * MOST CLUBS MANAGED - DISTINCT teamId across a manager's HUMAN eras.
 *
 * Two spells at one club is one club. That is the whole point of the category:
 * it measures breadth, and returning somewhere is not breadth.
 */
export function mostClubsManaged(
  humanEras: HallOfFameEra[],
  managers: Map<string, HallOfFameManager>
): RankedEntry<ClubsManagedEntry>[] {
  const clubsByUser = new Map<string, Set<string>>()
  for (const era of humanEras) {
    const set = clubsByUser.get(era.userId)
    if (set) set.add(era.teamId)
    else clubsByUser.set(era.userId, new Set([era.teamId]))
  }

  const entries: ClubsManagedEntry[] = []
  for (const [userId, teamIds] of clubsByUser) {
    const manager = managers.get(userId)
    if (manager) entries.push({ manager, clubs: teamIds.size })
  }
  return rankEntries(
    entries,
    (e) => e.clubs,
    (e) => e.manager.userId
  )
}

// ---------------------------------------------------------------------------
// THE WHOLE BOARD
// ---------------------------------------------------------------------------

export interface HallOfFame {
  /** The instant every number on the board was measured from. */
  measuredAt: Date
  managerChampionships: RankedEntry<ManagerChampionshipsEntry>[]
  clubChampionships: RankedEntry<ClubChampionshipsEntry>[]
  mostWins: RankedEntry<ManagerRecordEntry>[]
  mostMatches: RankedEntry<ManagerRecordEntry>[]
  bestWinRate: RankedEntry<WinRateEntry>[]
  longestTenures: RankedEntry<TenureEntry>[]
  mostClubsManaged: RankedEntry<ClubsManagedEntry>[]
  minimumMatchesForWinRate: number
}

export interface HallOfFameFacts {
  humanEras: HallOfFameEra[]
  championships: HallOfFameChampionship[]
  fixtures: FixtureResult[]
  managers: Map<string, HallOfFameManager>
  clubs: Map<string, HallOfFameClub>
}

/** Every leaderboard, built from one set of facts and ONE instant. */
export function buildHallOfFame(facts: HallOfFameFacts, now: Date): HallOfFame {
  const records = computeCareerRecords(facts.humanEras, facts.fixtures, now)
  return {
    measuredAt: now,
    managerChampionships: mostChampionshipsByManager(facts.championships, facts.humanEras, facts.managers),
    clubChampionships: mostChampionshipsByClub(facts.championships, facts.clubs),
    mostWins: mostWins(records, facts.managers),
    mostMatches: mostMatches(records, facts.managers),
    bestWinRate: bestWinRate(records, facts.managers),
    longestTenures: longestTenures(facts.humanEras, facts.managers, facts.clubs, now),
    mostClubsManaged: mostClubsManaged(facts.humanEras, facts.managers),
    minimumMatchesForWinRate: MIN_MATCHES_FOR_WIN_RATE,
  }
}
