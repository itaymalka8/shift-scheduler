/**
 * THE PLAYER DIRECTORY'S REQUEST CONTRACT. Pure: no Prisma, no clock, no I/O.
 *
 * This is a CURRENT DIRECTORY, not a ranking and not a career surface. Every
 * field it reads and filters on is current state from the Player row -
 * teamId, primaryPosition, nationality, careerStatus, status, overall - and
 * it computes no career figure of any kind. Historical detail lives on the
 * Player Profile, which the directory links to; duplicating any of it here
 * would be a second source of truth about somebody's history.
 *
 * PARSING FAILS SAFE, NEVER LOUD. A page route cannot answer 400, and a
 * garbage query string must not become a 500, so every malformed or unknown
 * value is IGNORED and the filter simply does not apply. That is the existing
 * app behaviour for a page (the API routes answer INVALID_REQUEST instead,
 * which is right for them and wrong here). The parsed result always describes
 * a valid, renderable request.
 */

/**
 * How many players a page shows.
 *
 * 25 is the number this codebase already uses for a paginated read - see
 * DEFAULT_LIMIT in the transfer market feed - so the directory does not
 * introduce a second page size. Against Production's 1320 players that is 53
 * pages; at 20 it would be 66 and at 30 it would be 44, all usable, and
 * matching the existing convention is worth more than any of that.
 */
export const DIRECTORY_PAGE_SIZE = 25

/** The canonical positions, in the order the game itself lists them. */
export { PLAYER_POSITIONS } from "./positions"

/**
 * The status axis, which is a PRODUCT axis rather than a database column: it
 * folds careerStatus (ACTIVE / RETIRED) together with "has no club", because
 * from a reader's point of view those are the three kinds of player that
 * exist and no single column expresses that.
 *
 *   all       everyone. The default - see below.
 *   active    careerStatus ACTIVE. Includes free agents, who are active
 *             players without a club.
 *   retired   careerStatus RETIRED.
 *   free      teamId is null. A player between clubs, or a retired one.
 */
export const DIRECTORY_STATUSES = ["all", "active", "retired", "free"] as const
export type DirectoryStatus = (typeof DIRECTORY_STATUSES)[number]

/**
 * THE DEFAULT IS "all", DELIBERATELY.
 *
 * Production today has 0 retired players and 0 free agents, so "all" and
 * "active" return identical results and the choice looks free. It is not: the
 * season lifecycle retires players at season end, and a default of "active"
 * would begin silently hiding them the moment the first one retires - a
 * change nobody would see happen. A directory that quietly stops listing
 * people is worse than one that lists more of them, the volume is bounded by
 * pagination either way, and the status filter is right there for anyone who
 * wants a narrower view.
 */
export const DEFAULT_DIRECTORY_STATUS: DirectoryStatus = "all"

export function isDirectoryStatus(value: string | null | undefined): value is DirectoryStatus {
  return !!value && (DIRECTORY_STATUSES as readonly string[]).includes(value)
}

/**
 * The longest search term accepted. Longer input is TRUNCATED rather than
 * rejected, so a paste of an entire paragraph still returns a sane (empty)
 * result instead of an error, and no unbounded string ever reaches the
 * database.
 */
export const MAX_SEARCH_LENGTH = 60

/**
 * Makes a search term match LITERALLY.
 *
 * Prisma's `contains` builds a LIKE/ILIKE pattern and binds the term as a
 * parameter - so there is no injection here - but it does NOT escape LIKE's
 * own metacharacters, and the parameter is still interpreted as a pattern.
 * Measured against PostgreSQL 16: `contains("%")` matched all 50 seeded
 * players, and `contains("C_hen")` matched "Cohen", because `_` is LIKE's
 * any-single-character wildcard.
 *
 * That is a correctness bug rather than a security one: somebody searching
 * for a literal underscore gets the wrong players, and somebody typing "%"
 * gets the entire directory. Escaping with a backslash - LIKE's default
 * escape character, verified to work through Prisma's bound parameter -
 * makes the term mean exactly what was typed.
 *
 * THE BACKSLASH IS ESCAPED FIRST, or it would double-escape the escapes it
 * just introduced.
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
}

export interface DirectoryParams {
  /** Trimmed, length-capped search text. Empty string means "no search". */
  q: string
  /** A canonical PlayerPosition, or null for "any position". */
  position: string | null
  /** A Team id, or null for "any club". Validated against the real club list. */
  club: string | null
  /** An ISO country code as stored on Player.nationality, or null. */
  nationality: string | null
  status: DirectoryStatus
  /** 1-based. Always at least 1; an out-of-range page is handled by the reader. */
  page: number
}

export const EMPTY_DIRECTORY_PARAMS: DirectoryParams = {
  q: "",
  position: null,
  club: null,
  nationality: null,
  status: DEFAULT_DIRECTORY_STATUS,
  page: 1,
}

/**
 * A page number, or 1.
 *
 * Only a plain positive integer is accepted - never a decimal, a sign,
 * exponential notation or padded whitespace, all of which Number() would
 * quietly take. This mirrors parseLimit in the transfer feed, which rejects
 * exactly the same shapes for exactly the same reason.
 */
function parsePage(raw: string | null | undefined): number {
  if (!raw || !/^[0-9]+$/.test(raw)) return 1
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n < 1) return 1
  return n
}

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/**
 * Reads a request into a valid DirectoryParams.
 *
 * `positions`, `clubIds` and `nationalities` are the values that ACTUALLY
 * exist, supplied by the caller. A filter value outside them is dropped
 * rather than passed to the database: it would match nothing anyway, and
 * echoing an arbitrary string back into the UI as a selected option is how a
 * page starts rendering someone else's input.
 */
export function parseDirectoryParams(
  searchParams: Record<string, string | string[] | undefined>,
  known: { positions: readonly string[]; clubIds: readonly string[]; nationalities: readonly string[] }
): DirectoryParams {
  const rawQ = first(searchParams.q) ?? ""
  const q = rawQ.trim().slice(0, MAX_SEARCH_LENGTH)

  const position = first(searchParams.position)
  const club = first(searchParams.club)
  const nationality = first(searchParams.nationality)
  const status = first(searchParams.status)

  return {
    q,
    position: position && known.positions.includes(position) ? position : null,
    club: club && known.clubIds.includes(club) ? club : null,
    nationality: nationality && known.nationalities.includes(nationality) ? nationality : null,
    status: isDirectoryStatus(status) ? status : DEFAULT_DIRECTORY_STATUS,
    page: parsePage(first(searchParams.page)),
  }
}

/** True when anything narrows the directory - drives the "clear filters" affordance. */
export function hasActiveFilters(params: DirectoryParams): boolean {
  return (
    params.q !== "" ||
    params.position !== null ||
    params.club !== null ||
    params.nationality !== null ||
    params.status !== DEFAULT_DIRECTORY_STATUS
  )
}

/**
 * The URL for a directory view. Only non-default values are emitted, so the
 * plain directory is `/players` and a shared link carries exactly the state
 * that differs from the default - which is what makes it readable and what
 * makes "page 1" not appear in every link.
 */
export function directoryHref(params: Partial<DirectoryParams>): string {
  const search = new URLSearchParams()
  if (params.q) search.set("q", params.q)
  if (params.position) search.set("position", params.position)
  if (params.club) search.set("club", params.club)
  if (params.nationality) search.set("nationality", params.nationality)
  if (params.status && params.status !== DEFAULT_DIRECTORY_STATUS) search.set("status", params.status)
  if (params.page && params.page > 1) search.set("page", String(params.page))
  const query = search.toString()
  return query ? `/players?${query}` : "/players"
}

export interface PageWindow {
  page: number
  totalPages: number
  hasPrevious: boolean
  hasNext: boolean
  /** 1-based index of the first row shown, or 0 when there are none. */
  from: number
  /** 1-based index of the last row shown, or 0 when there are none. */
  to: number
}

/**
 * Where this page sits in the result set.
 *
 * A page beyond the last one is not an error and not a 404: it is an empty
 * page, and the window still reports honestly which page was asked for so the
 * UI can offer a way back. Zero results give totalPages 1, so "page 1 of 1"
 * reads correctly on an empty directory rather than "page 1 of 0".
 */
export function computePageWindow(total: number, page: number, pageSize: number = DIRECTORY_PAGE_SIZE): PageWindow {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = total === 0 ? 0 : Math.min(total, page * pageSize)
  return {
    page,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
    from: from > total ? 0 : from,
    to: to < from ? 0 : to,
  }
}

/** How many rows to skip for a page. Never negative. */
export function skipFor(page: number, pageSize: number = DIRECTORY_PAGE_SIZE): number {
  return Math.max(0, (page - 1) * pageSize)
}
