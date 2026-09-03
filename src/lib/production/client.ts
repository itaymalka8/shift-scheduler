import { PrismaClient } from "@/generated/prisma"
import { assertProductionDatabaseUrl, parseDatabaseTarget, type DatabaseTarget } from "./env-guard"

export interface ProductionClient {
  prisma: PrismaClient
  target: DatabaseTarget
}

/**
 * The one place any scripts/production/*.ts file is allowed to construct a
 * Prisma client. Runs the safety guard first: a missing, invalid, or
 * localhost-pointing PRODUCTION_DATABASE_URL throws before any PrismaClient
 * is ever constructed. The client that does get built always has its
 * datasource URL overridden explicitly to PRODUCTION_DATABASE_URL - it
 * never reads DATABASE_URL, the variable the app itself uses.
 *
 * This is also why nothing under src/lib/production imports @/lib/prisma
 * (the app's own singleton) or anything that transitively does - e.g. the
 * season orchestrator, which imports @/lib/prisma directly. Merely
 * importing such a module runs `new PrismaClient()` at module load time as
 * a side effect (see src/lib/prisma.ts), which would construct a second,
 * unwanted client bound to DATABASE_URL. Any logic this package needs from
 * elsewhere in the app is either pure (safe to import directly - e.g.
 * src/lib/match/timing.ts) or deliberately re-implemented in miniature
 * here, with a comment explaining why.
 */
export function createProductionClient(env: NodeJS.ProcessEnv = process.env): ProductionClient {
  const url = assertProductionDatabaseUrl(env)
  const target = parseDatabaseTarget(url)
  const prisma = new PrismaClient({ datasourceUrl: url })
  return { prisma, target }
}
