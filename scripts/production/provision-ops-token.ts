/**
 * One-time, idempotent setup: if the web service doesn't already have a
 * PRODUCTION_OPS_READ_TOKEN, generates one and stores it directly on Render
 * via the Render API. The value is never printed, never written to any
 * file, never logged, never committed - only checked for presence, and set
 * once. MUTATES Production (sets one env var on the web service, which
 * Render will redeploy for) - requires PRODUCTION_WRITE_CONFIRM.
 *
 * Run once with:
 *   PRODUCTION_WRITE_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PRODUCTION npm run prod:ops:provision-token
 */
import { getWebServiceEnvVar, setWebServiceEnvVar } from "../../src/lib/production/render-ops"
import { RenderCredentialsMissingError } from "../../src/lib/production/render-client"
import { generateProductionOpsReadToken, PRODUCTION_OPS_READ_TOKEN_KEY } from "../../src/lib/production/ops-token"
import { ProductionWriteNotConfirmedError } from "../../src/lib/production/write-guard"

async function main() {
  console.info("=== prod:ops:provision-token ===")

  try {
    const existing = await getWebServiceEnvVar(PRODUCTION_OPS_READ_TOKEN_KEY)
    if (existing) {
      console.info(`${PRODUCTION_OPS_READ_TOKEN_KEY} is already set on the web service - leaving it unchanged.`)
      return
    }

    const token = generateProductionOpsReadToken()
    await setWebServiceEnvVar(PRODUCTION_OPS_READ_TOKEN_KEY, token)
    console.info(`${PRODUCTION_OPS_READ_TOKEN_KEY} generated and stored on Render. Value not printed here or anywhere else.`)
    console.info("Render will redeploy the web service to pick up the new environment variable.")
  } catch (error) {
    if (error instanceof RenderCredentialsMissingError || error instanceof ProductionWriteNotConfirmedError) {
      console.error(`REFUSED: ${error.message}`)
      process.exitCode = 1
      return
    }
    console.error("prod:ops:provision-token failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

main()
