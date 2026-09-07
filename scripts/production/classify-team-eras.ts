/**
 * READ ONLY. Classifies every Production club into the shapes the TeamEra
 * backfill recognises, so the backfill's determinism can be verified against
 * real data BEFORE anything is written.
 *
 * Deliberately does NOT query TeamEra: this runs before that table exists.
 * It reads Team and User only, and writes nothing.
 *
 * PRIVACY: no email, no name, no personal data is read or printed. Only
 * club ids, timestamps, and presence booleans (does this user have a
 * password hash / linked OAuth accounts) - which are what distinguish a
 * credential signup from an OAuth one, and therefore a takeover from a
 * born-human club.
 *
 * Run with: npm run prod:eras:classify
 */
import { createProductionClient } from "../../src/lib/production/client"
import { planTeamEraBackfill, type BackfillTeamInput } from "../../src/lib/teams/backfill-eras"

async function main() {
  console.info("=== prod:eras:classify ===")
  console.info("Mode:     READ ONLY - no writes, no TeamEra access\n")

  try {
    const { prisma, target } = createProductionClient()
    console.info(`Database: host=${target.host} name=${target.database}\n`)

    const teams = await prisma.team.findMany({
      select: {
        id: true,
        isBot: true,
        createdAt: true,
        userId: true,
        user: {
          select: {
            createdAt: true,
            passwordHash: true,
            _count: { select: { accounts: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    })

    const bot = teams.filter((t) => t.isBot && t.userId === null)
    const invalidBotOwned = teams.filter((t) => t.isBot && t.userId !== null)
    const human = teams.filter((t) => !t.isBot && t.userId !== null)
    const invalidHumanUnowned = teams.filter((t) => !t.isBot && t.userId === null)

    console.info("--- TEAM CLASSIFICATION ---")
    console.info(`TOTAL TEAMS: ${teams.length}`)
    console.info(`BOT (isBot=true, userId IS NULL): ${bot.length}`)
    console.info(`INVALID BOT OWNED (isBot=true, userId NOT NULL): ${invalidBotOwned.length}`)
    console.info(`HUMAN (isBot=false, userId NOT NULL): ${human.length}`)
    console.info(`INVALID HUMAN UNOWNED (isBot=false, userId IS NULL): ${invalidHumanUnowned.length}`)

    console.info("\n--- HUMAN TEAM ERA CLASSIFICATION ---")
    const takeoverCandidates = human.filter((t) => t.user && t.createdAt.getTime() < t.user.createdAt.getTime())
    const bornHumanCandidates = human.filter((t) => t.user && t.createdAt.getTime() >= t.user.createdAt.getTime())
    const missingUser = human.filter((t) => !t.user)

    console.info(`A. Team.createdAt <  User.createdAt  (historical BOT takeover): ${takeoverCandidates.length}`)
    console.info(`B. Team.createdAt >= User.createdAt  (born human):              ${bornHumanCandidates.length}`)
    console.info(`   Missing User relation (userId set, user row absent):        ${missingUser.length}`)

    for (const team of [...takeoverCandidates, ...bornHumanCandidates]) {
      const shape = team.createdAt.getTime() < team.user!.createdAt.getTime() ? "A takeover" : "B born-human"
      const auth = team.user!.passwordHash ? "credentials" : team.user!._count.accounts > 0 ? "oauth" : "neither"
      const gapMs = team.user!.createdAt.getTime() - team.createdAt.getTime()
      console.info(
        `   ${team.id}  ${shape}  auth=${auth}  team=${team.createdAt.toISOString()}  user=${team.user!.createdAt.toISOString()}  gap=${gapMs}ms`
      )
    }

    console.info("\n--- ANOMALIES ---")
    // Team.userId is @unique, so duplicate ownership should be impossible -
    // checked anyway rather than assumed, since this is the one run that
    // decides whether a data migration is safe.
    const ownerCounts = new Map<string, number>()
    for (const team of teams) {
      if (team.userId) ownerCounts.set(team.userId, (ownerCounts.get(team.userId) ?? 0) + 1)
    }
    const duplicateOwners = [...ownerCounts.entries()].filter(([, n]) => n > 1)
    console.info(`Duplicate ownership (one user, several clubs): ${duplicateOwners.length}`)

    const futureDated = teams.filter((t) => t.createdAt.getTime() > Date.now())
    console.info(`Timestamp anomaly - club created in the future: ${futureDated.length}`)

    // A takeover whose bot era would be zero-length: the CHECK constraint
    // (endedAt > startedAt) would reject it, so it must be zero.
    const zeroLengthEra = human.filter((t) => t.user && t.createdAt.getTime() === t.user.createdAt.getTime())
    console.info(`Timestamp anomaly - club and user created at the identical instant: ${zeroLengthEra.length}`)

    // Run the real planner over the real data - the same function the
    // backfill and the migration semantics are built on.
    const input: BackfillTeamInput[] = teams.map((team) => ({
      id: team.id,
      isBot: team.isBot,
      createdAt: team.createdAt,
      userId: team.userId,
      userCreatedAt: team.user?.createdAt ?? null,
      existingEraCount: 0,
    }))
    const plan = planTeamEraBackfill(input)

    console.info("\n--- PLANNER RESULT (dry, nothing written) ---")
    console.info(`Eras that would be created: ${plan.eras.length}`)
    console.info(`  open BOT:    ${plan.eras.filter((e) => e.type === "BOT" && e.endedAt === null).length}`)
    console.info(`  closed BOT:  ${plan.eras.filter((e) => e.type === "BOT" && e.endedAt !== null).length}`)
    console.info(`  open HUMAN:  ${plan.eras.filter((e) => e.type === "HUMAN").length}`)
    console.info(`Cannot be classified deterministically: ${plan.unresolved.length}`)
    for (const item of plan.unresolved) {
      console.info(`  ${item.teamId}: ${item.reason}`)
    }

    const deterministic = plan.unresolved.length === 0 && missingUser.length === 0 && duplicateOwners.length === 0
    console.info(`\nCLASSIFICATION: ${deterministic ? "100% DETERMINISTIC" : "NOT DETERMINISTIC"}`)
  } catch (error) {
    console.error("prod:eras:classify failed:", error instanceof Error ? error.message : error)
    console.error("CLASSIFICATION: FAIL")
    process.exitCode = 1
  }
}

main()
