/**
 * The fail-closed rule that decides whether a Production deploy pipeline is
 * allowed to run at all. Pure: no network, no env vars, no I/O - so every
 * branch of it is exercised by tests rather than argued about in prose.
 *
 * WHY THIS EXISTS. On 2026-09-03, commit 8bc5148 reached Production the
 * moment it was pushed to main, because Render's Auto Deploy was on. It
 * went live with no Neon backup, with the fixture-processor Cron still
 * running against a database mid-migration, and without a single one of
 * prod:deploy:safe's fourteen checks. The deploy happened to be fine. The
 * next one might not be.
 *
 * With Auto Deploy on, prod:deploy:safe is not a gate - it is a second
 * opinion arriving after the fact. Its backup is taken after the new code
 * is already serving traffic, and its Cron suspend protects a window that
 * has already closed. So the pipeline must refuse to run at all in that
 * state, rather than perform an expensive ritual that no longer means
 * anything.
 *
 * FAIL CLOSED. Three states, two of which refuse:
 *
 *   off      - Auto Deploy is confirmed disabled. Proceed.
 *   on       - Auto Deploy is confirmed enabled. REFUSE.
 *   unknown  - the setting could not be read: an API error, a response
 *              shape this code does not recognise, a service that could not
 *              be resolved. REFUSE.
 *
 * "unknown" refusing is the whole point. The dangerous state and the
 * unreadable state are indistinguishable from inside this process, so they
 * get the same answer. A guard that assumed "unknown means probably off"
 * would be a guard that silently stops working the first time Render
 * renames a field.
 *
 * BOTH SERVICES. The web service is the one that serves the app, but the
 * Cron service auto-deploying mid-pipeline is its own hazard: it would pick
 * up new code while prod:deploy:safe believes it has that service
 * suspended and frozen. Both must be confirmed off.
 */
import type { AutoDeployState } from "./render-client"

export type { AutoDeployState }

export interface AutoDeployReading {
  web: AutoDeployState
  cron: AutoDeployState
}

export interface AutoDeployGuardResult {
  allowed: boolean
  /** Human-readable summary of both readings - always safe to print (no credentials, no URLs). */
  detail: string
  /** Present only when allowed === false: why the pipeline refused, in the words the operator needs. */
  reason: string | null
}

export const AUTO_DEPLOY_OFF_INSTRUCTIONS =
  "Disable Auto Deploy on BOTH Render services (goalx-manager and goalx-manager-fixture-processor) " +
  "with `PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:render:autodeploy:off`, " +
  "then re-run this workflow."

export function describeAutoDeployState(state: AutoDeployState): string {
  return state.toUpperCase()
}

export function formatAutoDeployReading(reading: AutoDeployReading): string {
  return `web=${describeAutoDeployState(reading.web)} cron=${describeAutoDeployState(reading.cron)}`
}

export function evaluateAutoDeployGuard(reading: AutoDeployReading): AutoDeployGuardResult {
  const detail = formatAutoDeployReading(reading)

  const enabled = (["web", "cron"] as const).filter((service) => reading[service] === "on")
  if (enabled.length > 0) {
    return {
      allowed: false,
      detail,
      reason:
        `Render Auto Deploy is still ENABLED on: ${enabled.join(", ")}. ` +
        "Refusing to run a controlled deploy while pushes can reach Production on their own - the backup, " +
        "the Cron suspend and every check after them would be guarding a window that has already closed. " +
        AUTO_DEPLOY_OFF_INSTRUCTIONS,
    }
  }

  const unreadable = (["web", "cron"] as const).filter((service) => reading[service] === "unknown")
  if (unreadable.length > 0) {
    return {
      allowed: false,
      detail,
      reason:
        `Render Auto Deploy could NOT be confirmed disabled on: ${unreadable.join(", ")} (state: UNKNOWN). ` +
        "Fail closed: an unreadable setting is treated exactly like an enabled one, because from here they are " +
        "indistinguishable. Check the Auto Deploy setting on Render's dashboard for these services before retrying.",
    }
  }

  return { allowed: true, detail, reason: null }
}
