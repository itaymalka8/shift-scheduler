import { PrismaClient } from "@/generated/prisma"

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

// Always cache on globalThis, in every environment. Next.js's App Router can
// bundle separate route handlers into separate module instances within the
// same long-running Node process (unlike a single serverless invocation), so
// skipping this cache in production - as the old Vercel-oriented guidance
// suggested - let different routes end up with their own independent
// PrismaClient/SQLite connection instead of sharing one, causing reads right
// after a write (e.g. logging in right after registering) to intermittently
// miss data that was just committed by a different connection.
export const prisma = globalForPrisma.prisma ?? new PrismaClient()
globalForPrisma.prisma = prisma
