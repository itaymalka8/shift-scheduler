/**
 * Scheduled job entrypoint: flips every TransferListing whose expiresAt has
 * passed from OPEN to EXPIRED. Meant to run on a timer (a Render Cron Job -
 * see render.yaml), talking to Postgres directly via the same DATABASE_URL
 * as the web service. Never invoked from a page load or API route a
 * browser can reach.
 *
 * Run with: npx tsx scripts/expire-transfer-listings.ts
 */
import { expireDueTransferListings } from "../src/lib/transfers/expiration"
import { prisma } from "../src/lib/prisma"

expireDueTransferListings()
  .then(({ expiredCount }) => {
    console.info(`expireDueTransferListings: expired ${expiredCount} listing(s)`)
  })
  .catch((error) => {
    console.error("expireDueTransferListings failed:", error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
