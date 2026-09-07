/**
 * Runs a read-only production check WITHOUT this session ever holding
 * PRODUCTION_DATABASE_URL: fetches PRODUCTION_OPS_READ_TOKEN from Render's
 * own env vars (via the already-connected RENDER_API_KEY credential),
 * discovers the web service's public URL, and calls
 * /api/internal/production-ops there. The token exists only in this
 * process's memory for the duration of one HTTP call - never printed,
 * never written to disk, never logged.
 *
 * Run with:
 *   npm run prod:ops:preflight
 *   npm run prod:ops:season-status
 *   npm run prod:ops:scheduled-check
 */
import { getWebServiceEnvVar, getWebServiceUrl } from "../../src/lib/production/render-ops"
import { RenderCredentialsMissingError } from "../../src/lib/production/render-client"
import { PRODUCTION_OPS_READ_TOKEN_KEY } from "../../src/lib/production/ops-token"

const VALID_CHECKS = ["preflight", "season-status", "scheduled-check"] as const
type Check = (typeof VALID_CHECKS)[number]

function parseCheck(argv: string[]): Check | null {
  const value = argv[2]
  return (VALID_CHECKS as readonly string[]).includes(value) ? (value as Check) : null
}

async function main() {
  const check = parseCheck(process.argv)
  if (!check) {
    console.error(`Usage: tsx scripts/production/ops-check.ts <${VALID_CHECKS.join("|")}>`)
    process.exitCode = 1
    return
  }

  console.info(`=== prod:ops:${check} ===`)
  console.info("Mode:     READ ONLY (via Render, never PRODUCTION_DATABASE_URL)\n")

  try {
    const [token, url] = await Promise.all([getWebServiceEnvVar(PRODUCTION_OPS_READ_TOKEN_KEY), getWebServiceUrl()])

    if (!token) {
      console.error(`REFUSED: ${PRODUCTION_OPS_READ_TOKEN_KEY} is not set on the web service yet - run prod:ops:provision-token first.`)
      process.exitCode = 1
      return
    }
    if (!url) {
      console.error("REFUSED: could not discover the web service's public URL from Render.")
      process.exitCode = 1
      return
    }

    const response = await fetch(`${url}/api/internal/production-ops?check=${check}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body: unknown = await response.json()

    if (!response.ok) {
      console.error(`Production ops endpoint returned ${response.status}:`, body)
      process.exitCode = 1
      return
    }

    console.info(JSON.stringify(body, null, 2))
    if (check === "preflight" && (body as { pass?: boolean }).pass === false) {
      console.info("\nPRODUCTION PREFLIGHT: FAIL")
      process.exitCode = 1
    } else if (check === "preflight") {
      console.info("\nPRODUCTION PREFLIGHT: PASS")
    }
  } catch (error) {
    if (error instanceof RenderCredentialsMissingError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    console.error(`prod:ops:${check} failed:`, error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
