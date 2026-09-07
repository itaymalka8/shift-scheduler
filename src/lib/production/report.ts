import type { DatabaseTarget } from "./env-guard"

/**
 * Every production script prints this before doing anything else: which
 * script is running, that it is read-only, and which database it is
 * pointed at - host and database name only, never a credential.
 */
export function printProductionBanner(scriptName: string, target: DatabaseTarget, mode: "READ ONLY" = "READ ONLY"): void {
  console.info(`=== ${scriptName} ===`)
  console.info(`Mode:     ${mode}`)
  console.info(`Database: host=${target.host} name=${target.database}`)
  console.info("")
}
