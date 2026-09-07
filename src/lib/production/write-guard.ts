// Every future production script that mutates data (none exist yet - see
// scripts/production/README-style header comments) must call
// assertProductionWriteConfirmed() before doing so. Every script that
// exists today is read-only and never calls this at all.

export const PRODUCTION_WRITE_CONFIRMATION = "I_UNDERSTAND_THIS_CHANGES_PRODUCTION"

export class ProductionWriteNotConfirmedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProductionWriteNotConfirmedError"
  }
}

/**
 * Requires PRODUCTION_WRITE_CONFIRM to equal the exact confirmation string -
 * not "set to something truthy", not "1", not "true". Anything else
 * (missing, empty, a typo, a stray whitespace) throws. There is no way to
 * opt in "by accident".
 */
export function assertProductionWriteConfirmed(env: Record<string, string | undefined> = process.env): void {
  if (env.PRODUCTION_WRITE_CONFIRM !== PRODUCTION_WRITE_CONFIRMATION) {
    throw new ProductionWriteNotConfirmedError(
      `Refusing to write to Production: set PRODUCTION_WRITE_CONFIRM=${PRODUCTION_WRITE_CONFIRMATION} to confirm.`
    )
  }
}
