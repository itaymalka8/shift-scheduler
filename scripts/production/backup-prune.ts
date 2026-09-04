/**
 * DESTRUCTIVE (in --execute mode): permanently deletes pre-deploy backup
 * branches from the Neon project. A deleted backup is a Production recovery
 * point that no longer exists, and Neon has no undo.
 *
 * DRY RUN IS THE DEFAULT. Without --execute this makes only GET requests and
 * prints the plan it would carry out. --execute additionally requires
 * PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION, which is
 * checked BEFORE the first API call rather than just before the first DELETE.
 *
 * THERE IS NO WILDCARD. Every branch to delete must be named explicitly by
 * id. There is deliberately no --all, no --older-than, and no "delete
 * everything eligible" mode: the point of this command is that a human read
 * a list and chose from it. Run it with no ids to get that list, complete
 * with a recommendation, and then paste the ids back in.
 *
 * PARTIAL ALLOWLISTS DELETE NOTHING. If any one requested id fails any gate,
 * the whole run is refused - see backup-prune.ts's header for why.
 *
 * Run with:
 *   npm run prod:backup:prune                                  # inventory + recommendation
 *   npm run prod:backup:prune -- --branches br-a,br-b          # dry run of a specific plan
 *   PRODUCTION_WRITE_CONFIRM=... npm run prod:backup:prune -- --branches br-a,br-b --execute
 *
 * PRUNE_BRANCH_IDS / PRUNE_EXECUTE / PRUNE_SLOTS_TO_FREE are env equivalents
 * of the three flags, for the GitHub Actions path where passing argv through
 * `npm run` is awkward. Flags win when both are present.
 */
import {
  MINIMUM_RETAINED_BACKUPS,
  identifyBackups,
  planBackupPrune,
  recommendPruneCandidates,
  supersededBy,
  distinctBackupDays,
  parsePruneArgs,
  verifyPostPrune,
  type BackupBranch,
} from "../../src/lib/production/backup-prune"
import {
  BackupDeletionRefusedError,
  deleteBackupBranch,
  getProductionBranch,
  listBranches,
} from "../../src/lib/production/neon-ops"
import { NeonCredentialsMissingError } from "../../src/lib/production/neon-client"
import { assertProductionWriteConfirmed, ProductionWriteNotConfirmedError } from "../../src/lib/production/write-guard"

function describe(b: BackupBranch): string {
  return `${b.name} (${b.id}) created=${b.createdAt}`
}

async function main() {
  const args = parsePruneArgs(process.argv.slice(2), process.env)

  console.info("=== prod:backup:prune ===")
  console.info(`Mode:     ${args.execute ? "EXECUTE (PERMANENTLY DELETES BACKUP BRANCHES)" : "DRY RUN (read-only, deletes nothing)"}`)
  console.info(`Retention floor: ${MINIMUM_RETAINED_BACKUPS} newest backups always retained\n`)

  try {
    // Fail closed on a missing confirmation BEFORE any API call, so an
    // unconfirmed --execute never even reaches Neon.
    if (args.execute) assertProductionWriteConfirmed(process.env)

    const [production, branchesBefore] = await Promise.all([getProductionBranch(), listBranches()])
    const productionBranchId = production.id

    console.info(`Production branch: ${production.name} (${productionBranchId}) primary=${production.primary}`)
    console.info(`Project has ${branchesBefore.length} branch(es).\n`)

    const backups = identifyBackups(branchesBefore, productionBranchId)
    const nonBackups = branchesBefore.filter((b) => b.id !== productionBranchId && !backups.some((k) => k.id === b.id))

    console.info(`PRE-DEPLOY BACKUPS (${backups.length}), newest first:`)
    backups.forEach((b, i) => {
      const tag = i < MINIMUM_RETAINED_BACKUPS ? "  [PROTECTED - newest]" : ""
      console.info(`  ${String(i + 1).padStart(2)}. ${describe(b)}${tag}`)
    })
    console.info(`  distinct backup days: ${distinctBackupDays(backups).join(", ") || "none"}`)

    if (nonBackups.length > 0) {
      console.info(`\nNOT BACKUPS (${nonBackups.length}) - never eligible for pruning:`)
      for (const b of nonBackups) console.info(`  ${b.name} (${b.id}) parent=${b.parentId ?? "none"}`)
    }

    if (args.branchIds.length === 0) {
      const recommended = recommendPruneCandidates(branchesBefore, productionBranchId, args.slotsToFree)
      console.info(`\nNo --branches given, so nothing will be planned or deleted.`)
      if (!recommended) {
        console.info(
          `Cannot free ${args.slotsToFree} slot(s) without breaking the retention floor of ${MINIMUM_RETAINED_BACKUPS}: ` +
            `only ${Math.max(0, backups.length - MINIMUM_RETAINED_BACKUPS)} backup(s) are eligible.`
        )
        return
      }
      console.info(`\nRECOMMENDED ALLOWLIST to free ${args.slotsToFree} slot(s) - the ${recommended.length} OLDEST eligible backup(s):`)
      for (const b of recommended) {
        const newer = supersededBy(backups, b)
        console.info(`  ${describe(b)}`)
        console.info(`      superseded by ${newer.length} newer recovery point(s): ${newer.map((n) => n.name).join(", ")}`)
      }
      const survivors = backups.filter((b) => !recommended.some((r) => r.id === b.id))
      console.info(`\n  would leave ${survivors.length} backup(s) across days: ${distinctBackupDays(survivors).join(", ")}`)
      console.info(`  would leave ${branchesBefore.length - recommended.length} total branch(es)`)
      console.info(`\nRe-run with:  npm run prod:backup:prune -- --branches ${recommended.map((b) => b.id).join(",")}`)
      return
    }

    const plan = planBackupPrune({ branches: branchesBefore, productionBranchId, requestedIds: args.branchIds })

    console.info(`\nREQUESTED (${args.branchIds.length}): ${args.branchIds.join(", ")}`)

    if (!plan.ok) {
      console.error("\nPRUNE REFUSED - NOTHING WAS DELETED.")
      if (plan.reason) console.error(`  ${plan.reason}`)
      for (const r of plan.refusals) console.error(`  [${r.code}] ${r.branchId}: ${r.detail}`)
      console.error("\nA partially valid allowlist deletes nothing on purpose. Fix the list and re-run.")
      process.exitCode = 1
      return
    }

    console.info(`\nPLAN OK. ${plan.deletable.length} branch(es) eligible for deletion:`)
    for (const b of plan.deletable) {
      const newer = supersededBy(plan.backups, b)
      console.info(`  ${describe(b)}`)
      console.info(`      superseded by ${newer.length} newer recovery point(s): ${newer.map((n) => n.name).join(", ")}`)
    }
    console.info(`\nRETAINED (${plan.backupsAfter}):`)
    for (const b of plan.backups.filter((b) => !plan.deletable.some((d) => d.id === b.id))) console.info(`  ${describe(b)}`)
    console.info(`\nBranches: ${branchesBefore.length} -> ${plan.totalBranchesAfter}`)

    if (!args.execute) {
      console.info("\nDRY RUN - NOTHING WAS DELETED.")
      console.info(`To execute: PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:backup:prune -- --branches ${plan.deletable.map((b) => b.id).join(",")} --execute`)
      return
    }

    console.info("\nEXECUTING DELETIONS...")
    const deleted: string[] = []
    for (const b of plan.deletable) {
      try {
        await deleteBackupBranch(b.id)
        deleted.push(b.id)
        console.info(`  DELETED ${b.name} (${b.id})`)
      } catch (error) {
        // Stop at the FIRST failure. Whatever made one delete fail - a
        // revoked key, a rate limit, a branch that turned out to be
        // protected - applies to the rest of the list until a human has
        // looked at it.
        console.error(`  FAILED on ${b.name} (${b.id}): ${error instanceof Error ? error.message : error}`)
        console.error(`  STOPPING IMMEDIATELY. ${deleted.length} branch(es) were deleted before this point: ${deleted.join(", ") || "none"}`)
        process.exitCode = 1
        return
      }
    }

    console.info("\nPOST-PRUNE VERIFICATION (fresh read from Neon):")
    const [productionAfter, branchesAfter] = await Promise.all([getProductionBranch(), listBranches()])
    const verification = verifyPostPrune({
      branchesAfter,
      productionBranchIdBefore: productionBranchId,
      productionBranchIdAfter: productionAfter.id,
      deletedIds: deleted,
      branchesBefore: branchesBefore.length,
      branchLimit: process.env.NEON_BRANCH_LIMIT ? Number(process.env.NEON_BRANCH_LIMIT) : null,
    })
    for (const c of verification.checks) console.info(`  [${c.ok ? "OK" : "FAIL"}] ${c.name}: ${c.detail}`)

    console.info(`\n${branchesAfter.length} branch(es) remain:`)
    for (const b of branchesAfter) {
      const marker = b.id === productionAfter.id ? " <- production" : b.parentId === productionAfter.id ? " (child of production)" : ""
      console.info(`  ${b.name} (${b.id}) created=${b.createdAt}${marker}`)
    }

    if (!verification.ok) {
      console.error("\nPRUNE VERIFICATION: FAIL - deletions were made but the post-state could not be proven safe. Do not deploy.")
      process.exitCode = 1
      return
    }
    console.info("\nPRUNE: PASS")
  } catch (error) {
    if (error instanceof ProductionWriteNotConfirmedError || error instanceof BackupDeletionRefusedError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    if (error instanceof NeonCredentialsMissingError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    console.error("prod:backup:prune failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
