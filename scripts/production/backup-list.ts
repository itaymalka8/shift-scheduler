/**
 * Read-only: lists every Neon branch on the discovered project, marking
 * which one is production. No secrets printed.
 *
 * Run with: npm run prod:backup:list
 */
import { getProductionBranch, listBranches } from "../../src/lib/production/neon-ops"
import { NeonCredentialsMissingError } from "../../src/lib/production/neon-client"

async function main() {
  console.info("=== prod:backup:list ===")
  console.info("Mode:     READ ONLY\n")

  try {
    const [production, branches] = await Promise.all([getProductionBranch(), listBranches()])
    console.info(`Production branch: ${production.name} (${production.id})\n`)
    console.info(`${branches.length} branch(es):`)
    for (const b of branches) {
      const marker = b.id === production.id ? " <- production" : b.parentId === production.id ? " (child of production)" : ""
      console.info(`  ${b.name} (${b.id}) created=${b.createdAt}${marker}`)
    }
  } catch (error) {
    if (error instanceof NeonCredentialsMissingError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    console.error("prod:backup:list failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
