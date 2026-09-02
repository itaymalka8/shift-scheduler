// The one gate every scripts/production/*.ts file must pass before it is
// allowed to construct a Prisma client. Nothing in here ever reads
// DATABASE_URL - the app's own connection string (see src/lib/prisma.ts) -
// and nothing in here ever returns or logs a username or password: callers
// that need the full connection string keep the original value themselves,
// this module only ever hands back the safe-to-print half (host + database
// name).

export class ProductionSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProductionSafetyError"
  }
}

export interface DatabaseTarget {
  host: string
  database: string
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"])

/**
 * Parses a Postgres connection string into host + database name only.
 * Never inspects username/password, and never returns them - there is no
 * field in the returned object that could carry a credential even by
 * accident.
 */
export function parseDatabaseTarget(rawUrl: string): DatabaseTarget {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new ProductionSafetyError("PRODUCTION_DATABASE_URL is not a valid URL.")
  }
  const database = parsed.pathname.replace(/^\//, "")
  if (!parsed.hostname || !database) {
    throw new ProductionSafetyError("PRODUCTION_DATABASE_URL is missing a host or a database name.")
  }
  return { host: parsed.hostname, database }
}

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase())
}

/**
 * The hard safety guard: PRODUCTION_DATABASE_URL must be set, must parse as
 * a URL with a host and database name, and must not point at
 * localhost/127.0.0.1/::1/0.0.0.0 - the default nearly every developer's
 * own DATABASE_URL points at, and exactly the value a script would silently
 * fall back to if it read the wrong environment variable. There is no
 * fallback to DATABASE_URL anywhere in this function or in anything that
 * calls it - a missing PRODUCTION_DATABASE_URL is a hard stop, not a
 * "use the local one instead".
 *
 * Throws ProductionSafetyError on any violation. Returns the raw URL
 * untouched (still never printed by anything in this module) so the caller
 * can hand it straight to Prisma.
 */
export function assertProductionDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const rawUrl = env.PRODUCTION_DATABASE_URL
  if (!rawUrl || rawUrl.trim() === "") {
    throw new ProductionSafetyError(
      "PRODUCTION_DATABASE_URL is not set. Production scripts never fall back to DATABASE_URL - set PRODUCTION_DATABASE_URL explicitly to run this."
    )
  }

  const target = parseDatabaseTarget(rawUrl)
  if (isLoopbackHost(target.host)) {
    throw new ProductionSafetyError(
      `PRODUCTION_DATABASE_URL points at "${target.host}", which looks like a local database, not Production. Refusing to proceed.`
    )
  }

  return rawUrl
}
