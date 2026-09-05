/**
 * THE PLAYER DIRECTORY READER.
 *
 * Read-only over CURRENT state. There is no write path in this file, no career
 * aggregation, and no import of the Player Profile's history layer: the
 * directory finds a player and links to their profile, which is where
 * historical detail lives. Reusing the profile's career reader to build a
 * directory row would run a full career computation per row - an N+1 in
 * disguise - and would put a second copy of career logic on a page that has
 * no business owning one.
 *
 * THE QUERY SHAPE, and why:
 *
 *   1  Team    every club, once, for the filter dropdown AND for resolving
 *              each row's club name and crest.
 *   2  Player  count matching the filters.
 *   3  Player  one page of matching rows.
 *
 * NOT ONE TEAM LOOKUP PER PLAYER. Query 1 is the whole club list - 60 rows in
 * Production, and bounded by the number of clubs rather than by the number of
 * players - so a page of 25 players resolves 25 clubs from memory. Fetching
 * the club through a relation on each row would have Prisma issue a second
 * statement per page; fetching it per row would be an N+1. A source guard
 * asserts the count.
 *
 * SEARCH IS PARAMETERIZED PRISMA, NEVER RAW SQL. User text reaches the
 * database only as a bound parameter through Prisma's `contains`, so there is
 * no interpolation to escape and no injection surface to reason about.
 */
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/generated/prisma"
import { PLAYER_POSITIONS as CANONICAL_POSITIONS } from "./positions"
import {
  DIRECTORY_PAGE_SIZE,
  escapeLikeTerm,
  computePageWindow,
  skipFor,
  type DirectoryParams,
  type DirectoryStatus,
  type PageWindow,
} from "./directory"

const CLUB_SELECT = {
  id: true,
  name: true,
  crestShape: true,
  crestPattern: true,
  crestIcon: true,
  crestColor: true,
  crestSecondaryColor: true,
  crestBorderColor: true,
  crestImageUrl: true,
} as const

export interface DirectoryClub {
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

/**
 * One directory row. Deliberately compact - a name, where they play and who
 * for. No attribute dump, and no career figure: the profile holds both.
 */
export interface DirectoryPlayer {
  /** THE canonical identity, and the only thing that addresses the profile. */
  id: string
  firstName: string
  lastName: string
  primaryPosition: string
  nationality: string
  age: number
  shirtNumber: number
  overall: number
  careerStatus: string
  /** Current club, from Player.teamId - which is what that column means. */
  club: DirectoryClub | null
}

export interface DirectoryResult {
  players: DirectoryPlayer[]
  total: number
  window: PageWindow
  /** Every club, for the filter control and for row rendering. */
  clubs: DirectoryClub[]
  /** The nationalities that actually exist, so a filter is offered only if it filters. */
  nationalities: string[]
  /** The positions that actually exist, in canonical order. */
  positions: string[]
}

/**
 * The status axis in SQL.
 *
 * "active" deliberately does NOT exclude free agents: a player between clubs
 * is an active player, and hiding them under Active would make the two
 * filters contradict each other.
 */
function statusWhere(status: DirectoryStatus): Prisma.PlayerWhereInput {
  switch (status) {
    case "active":
      return { careerStatus: "ACTIVE" }
    case "retired":
      return { careerStatus: "RETIRED" }
    case "free":
      return { teamId: null }
    case "all":
    default:
      return {}
  }
}

/**
 * The search clause.
 *
 * Matches a first name OR a last name. Both halves are matched against the
 * SAME term rather than the term being split on whitespace, because splitting
 * would turn "Cohen" into a prefix search on nothing and "David Cohen" into a
 * query that has to guess which word is which - and Production has only 42
 * distinct first names against 44 surnames, so the two pools overlap heavily
 * and guessing would be wrong often.
 *
 * `mode: "insensitive"` is PostgreSQL ILIKE. `contains` binds the term as a
 * parameter; it is never concatenated into SQL.
 */
function searchWhere(q: string): Prisma.PlayerWhereInput {
  if (q === "") return {}
  // Escaped so LIKE's own wildcards are matched literally - see
  // escapeLikeTerm. Without it "%" returns the whole directory.
  const term = escapeLikeTerm(q)
  return {
    OR: [
      { firstName: { contains: term, mode: "insensitive" } },
      { lastName: { contains: term, mode: "insensitive" } },
    ],
  }
}

export function buildDirectoryWhere(params: DirectoryParams): Prisma.PlayerWhereInput {
  const clauses: Prisma.PlayerWhereInput[] = [statusWhere(params.status), searchWhere(params.q)]
  if (params.position) clauses.push({ primaryPosition: params.position })
  // Current club filtering correctly uses Player.teamId: this is current
  // state, and it is a different question from where an old goal belongs.
  if (params.club) clauses.push({ teamId: params.club })
  if (params.nationality) clauses.push({ nationality: params.nationality })
  const active = clauses.filter((c) => Object.keys(c).length > 0)
  return active.length === 0 ? {} : { AND: active }
}

/**
 * THE DEFAULT ORDER: surname, then first name, then id.
 *
 * A directory is a place to FIND somebody, so it is ordered the way a
 * directory is ordered - alphabetically - and not by any sporting measure.
 * Ordering by `overall` would rank players by ability on a page whose whole
 * purpose is neutral lookup, and would read as a rating board; the squad
 * screen orders that way because it is a team-selection tool, which this is
 * not.
 *
 * The id tiebreak is what makes paging safe: surname and first name together
 * are NOT unique here (Production has 1320 players drawn from 44 surnames and
 * 42 first names), so without it two pages could repeat or skip a row. It is
 * an immutable id used purely to make the order total, and carries no meaning.
 */
const DIRECTORY_ORDER: Prisma.PlayerOrderByWithRelationInput[] = [
  { lastName: "asc" },
  { firstName: "asc" },
  { id: "asc" },
]

const DIRECTORY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  primaryPosition: true,
  nationality: true,
  age: true,
  shirtNumber: true,
  overall: true,
  careerStatus: true,
  teamId: true,
} as const

/**
 * What the filter controls can offer, and what parseDirectoryParams validates
 * an incoming query string against.
 *
 * Loaded ONCE per request and then passed into loadPlayerDirectory, rather
 * than each of them querying independently - the params cannot be parsed
 * without knowing which clubs exist, and the page cannot be rendered without
 * the parsed params, so the order is forced and the facets must be shared.
 *
 * Every list here is grouped in SQL. None of it pulls players into memory.
 */
export interface DirectoryFacets {
  clubs: DirectoryClub[]
  clubIds: string[]
  /** Nationalities that actually occur, sorted. A filter with one value filters nothing. */
  nationalities: string[]
  /** Positions that actually occur, in canonical order. */
  positions: string[]
}

export async function loadDirectoryFacets(): Promise<DirectoryFacets> {
  const [clubs, nationalityRows, positionRows] = await Promise.all([
    // EVERY CLUB, ONCE. Bounded by club count (60 in Production), never by
    // player count, and it serves both the filter control and every row's
    // crest - so a page of 25 players resolves 25 clubs from memory.
    prisma.team.findMany({ orderBy: { name: "asc" }, select: CLUB_SELECT }),
    prisma.player.groupBy({ by: ["nationality"], _count: { _all: true } }),
    prisma.player.groupBy({ by: ["primaryPosition"], _count: { _all: true } }),
  ])
  const present = new Set(positionRows.map((r) => r.primaryPosition))
  return {
    clubs,
    clubIds: clubs.map((c) => c.id),
    nationalities: nationalityRows.map((r) => r.nationality).sort(),
    // Canonical order, filtered to what exists - so the control never offers
    // a position no player holds, and never invents an order of its own.
    positions: CANONICAL_POSITIONS.filter((p) => present.has(p)),
  }
}

/** One page of the directory. Facets are supplied, never re-queried. */
export async function loadPlayerDirectory(
  params: DirectoryParams,
  facets: DirectoryFacets,
  pageSize: number = DIRECTORY_PAGE_SIZE
): Promise<DirectoryResult> {
  const where = buildDirectoryWhere(params)
  const clubsById = new Map<string, DirectoryClub>(facets.clubs.map((c) => [c.id, c]))

  // The count and the page, issued together. Two statements, whatever the
  // number of results.
  const [total, rows] = await Promise.all([
    prisma.player.count({ where }),
    prisma.player.findMany({
      where,
      orderBy: DIRECTORY_ORDER,
      skip: skipFor(params.page, pageSize),
      take: pageSize,
      select: DIRECTORY_SELECT,
    }),
  ])

  return {
    players: rows.map((row) => ({
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      primaryPosition: row.primaryPosition,
      nationality: row.nationality,
      age: row.age,
      shirtNumber: row.shirtNumber,
      overall: row.overall,
      careerStatus: row.careerStatus,
      club: row.teamId ? (clubsById.get(row.teamId) ?? null) : null,
    })),
    total,
    window: computePageWindow(total, params.page, pageSize),
    clubs: facets.clubs,
    nationalities: facets.nationalities,
    positions: facets.positions,
  }
}
