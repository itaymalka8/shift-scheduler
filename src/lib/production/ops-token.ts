import { randomBytes } from "node:crypto"

// The Render env var key the Production Ops read endpoint checks against -
// see src/app/api/internal/production-ops/route.ts.
export const PRODUCTION_OPS_READ_TOKEN_KEY = "PRODUCTION_OPS_READ_TOKEN"

// 32 bytes = 256 bits, the same strength convention this repo already uses
// for NEXTAUTH_SECRET (render.yaml: "Generate one with: openssl rand -base64 32").
const PRODUCTION_OPS_READ_TOKEN_BYTES = 32

/** A cryptographically random hex token - never derived from anything guessable, never logged by any caller. */
export function generateProductionOpsReadToken(): string {
  return randomBytes(PRODUCTION_OPS_READ_TOKEN_BYTES).toString("hex")
}
