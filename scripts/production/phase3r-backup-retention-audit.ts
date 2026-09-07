/**
 * prod:phase3r:backup-retention-audit - CAN PRODUCTION STILL BE RECOVERED?
 *
 * WHAT THIS IS NOT. It is not `prod:retention:verify`, which asks whether the
 * DATABASE preserves its own history (foreign keys that RESTRICT rather than
 * cascade). This asks the different question closure needs answered: if the
 * database were lost or corrupted, do the Neon point-in-time branches that
 * would restore it still exist? Both are called "retention"; they share no
 * evidence, so both are required and neither substitutes for the other.
 *
 * STRICTLY READ ONLY, AND STRUCTURALLY SO. It imports exactly three Neon
 * helpers - getProjectDetails, getProductionBranch and listBranches - all of
 * which are GETs. It imports NO branch creation, deletion, rename, reset or
 * restore helper, so there is no mutation path in this file to reach even by
 * mistake. It also never sets PRODUCTION_WRITE_CONFIRM, which every mutating
 * Neon helper asserts before its first write.
 *
 * WHAT COUNTS AS A BACKUP IS NOT DECIDED HERE. identifyBackups, from the prune
 * authority, requires two independent signals to agree: the pre-deploy naming
 * convention AND being a child of the Production branch. That is what makes an
 * unrelated branch unable to pad the retention count, and it means this audit
 * and the command that deletes backups cannot disagree about what one is.
 * MINIMUM_RETAINED_BACKUPS is imported from that same module rather than
 * restated, so the floor the audit checks is the floor the prune refuses to
 * cross.
 *
 * PRODUCTION IS IDENTIFIED BY ID, NEVER BY NAME. getProductionBranch resolves
 * it through the canonical discovery path (primary flag first), and the result
 * must equal the approved branch id exactly - a branch someone renamed to look
 * like Production cannot satisfy this.
 *
 * ANY UNREADABLE VALUE IS A REFUSAL. An audit that could not read is an audit
 * that failed, never one that passed quietly.
 *
 * CREDENTIALS: NEON_API_KEY only, and only for GETs. No database URL, no
 * Render key, no write confirmation.
 */
import { getProductionBranch, getProjectDetails, listBranches } from "../../src/lib/production/neon-ops"
import { MINIMUM_RETAINED_BACKUPS } from "../../src/lib/production/backup-prune"
import { evaluateBackupRetention, PHASE_3R_CLOSURE, type BackupRetentionReading } from "../../src/lib/production/phase3r-closure"

const C = PHASE_3R_CLOSURE

async function main(): Promise<void> {
  console.info("=== prod:phase3r:backup-retention-audit ===")
  console.info("Mode:     READ ONLY - GET operations only, no branch mutation helper is imported")
  console.info(`Expected Production branch: ${C.neonProductionBranchId}`)
  console.info(`Expected branch limit:      ${C.expectedBranchLimit}`)
  console.info(`Retention floor:            ${MINIMUM_RETAINED_BACKUPS} (imported from the prune authority)`)
  console.info("")

  const project = await getProjectDetails().catch(() => null)
  const branchList = await listBranches().catch(() => null)
  const production = await getProductionBranch().catch(() => null)

  const reading: BackupRetentionReading = {
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    branchLimit: project?.branchLimit ?? null,
    branches: branchList,
    productionBranch: production ? { id: production.id, name: production.name, primary: production.primary } : null,
  }

  const verdict = evaluateBackupRetention(reading)

  console.info("--- NEON PROJECT ---")
  console.info(`  project:              ${reading.projectName ?? "UNREADABLE"} (${reading.projectId ?? "UNREADABLE"})`)
  console.info(`  branch limit:         ${reading.branchLimit ?? "UNREADABLE"}`)
  console.info(`  branches present:     ${verdict.branchCount ?? "UNREADABLE"}`)
  console.info(`  Production branch:    ${reading.productionBranch?.id ?? "UNREADABLE"} ("${reading.productionBranch?.name ?? "?"}")`)
  console.info(`  Production primary:   ${reading.productionBranch?.primary ?? "UNREADABLE"}`)
  console.info("")

  console.info("--- PRE-DEPLOY BACKUPS OF PRODUCTION (prune authority) ---")
  console.info(`  identified backups:   ${verdict.backups.length}  (floor ${verdict.retentionFloor})`)
  for (const backup of verdict.backups) console.info(`    ${backup.id}  ${backup.name}  taken ${backup.takenAt.toISOString()}`)
  console.info("")

  console.info("--- REQUIRED RECOVERY POINTS ---")
  const backupIds = new Set(verdict.backups.map((backup) => backup.id))
  for (const required of C.requiredRecoveryPoints) {
    console.info(`  ${backupIds.has(required.id) ? "PRESENT" : "MISSING"}  ${required.id}  ${required.name}`)
  }
  console.info("")

  if (!verdict.ok) {
    for (const refusal of verdict.refusals) console.error(`  FAIL [${refusal.code}] ${refusal.detail}`)
    console.error("")
    console.error("PHASE 3R BACKUP RETENTION AUDIT: FAIL")
    process.exitCode = 1
    return
  }

  console.info("PHASE 3R BACKUP RETENTION AUDIT: PASS")
}

main().catch((error) => {
  console.error("prod:phase3r:backup-retention-audit crashed:", error instanceof Error ? error.message : error)
  console.error("This command is READ ONLY - a crash cannot have changed Neon or Production.")
  process.exitCode = 1
})
