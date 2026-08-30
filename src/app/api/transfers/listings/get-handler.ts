import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { invalidRequestResponse, handleTransferApiError } from "@/lib/transfers/http"

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 50

/**
 * Only accepts a plain non-negative integer string ("25"), never a decimal
 * ("25.5"), a sign ("+25"/"-1"), exponential notation ("1e2"), or anything
 * with surrounding whitespace - Number()/parseInt() would silently accept
 * several of those. Returns null for "reject with INVALID_REQUEST", not a
 * thrown error - malformed pagination input is a request-shape problem for
 * this route, not a domain error.
 */
function parseLimit(raw: string | null): number | null {
  if (raw === null) return DEFAULT_LIMIT
  if (!/^[0-9]+$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_LIMIT) return null
  return n
}

interface Cursor {
  createdAt: Date
  id: string
}

/**
 * The listing order is (createdAt desc, id desc) - createdAt alone is not
 * unique (two listings can be created in the same millisecond), so a cursor
 * built from createdAt only could skip or repeat rows across pages. Encoding
 * both fields lets the next page's WHERE clause resume from the exact same
 * (createdAt, id) pair the previous page ended on.
 */
function encodeCursor(item: Cursor): string {
  return Buffer.from(JSON.stringify({ createdAt: item.createdAt.toISOString(), id: item.id }), "utf8").toString("base64url")
}

function decodeCursor(raw: string): Cursor | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const { createdAt, id } = parsed as Record<string, unknown>
  if (typeof createdAt !== "string" || typeof id !== "string" || id.length === 0) return null
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return null
  return { createdAt: date, id }
}

/**
 * Read-only market listing feed for an already-resolved, trusted teamId -
 * used only to compute `isOwnListing`, never to filter or restrict which
 * listings are visible. This function must never call any function that
 * writes to the database (ensureTransferWindowExists, expireDueTransferListings,
 * createTransferListing, purchaseTransferListing, releasePlayer, or any other
 * mutation) - a listing that is still OPEN in the database but whose
 * expiresAt has already passed is simply excluded from the result, never
 * "fixed" here; the expiration processor owns that transition on its own
 * schedule. Kept out of route.ts (which may only export HTTP method handlers
 * and route segment config, per Next.js's route-file type constraints) so it
 * can be exercised directly in tests.
 */
export async function handleListMarketListingsRequest(teamId: string, searchParams: URLSearchParams): Promise<NextResponse> {
  const limit = parseLimit(searchParams.get("limit"))
  if (limit === null) {
    return invalidRequestResponse()
  }

  const rawCursor = searchParams.get("cursor")
  let cursor: Cursor | null = null
  if (rawCursor !== null) {
    cursor = decodeCursor(rawCursor)
    if (cursor === null) {
      return invalidRequestResponse()
    }
  }

  // Read `now` exactly once and reuse it for the entire request, so a single
  // GET call sees one consistent instant rather than potentially crossing an
  // expiry boundary mid-query.
  const now = new Date()

  try {
    const listings = await prisma.transferListing.findMany({
      where: {
        status: "OPEN",
        expiresAt: { gt: now },
        ...(cursor
          ? {
              OR: [{ createdAt: { lt: cursor.createdAt } }, { AND: [{ createdAt: cursor.createdAt }, { id: { lt: cursor.id } }] }],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        askingPrice: true,
        expiresAt: true,
        createdAt: true,
        sellingTeamId: true,
        player: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            age: true,
            overall: true,
            primaryPosition: true,
            secondaryPositions: true,
            marketValue: true,
            weeklySalary: true,
            nationality: true,
            preferredFoot: true,
            fitness: true,
          },
        },
        sellingTeam: {
          select: {
            id: true,
            name: true,
            crestShape: true,
            crestPattern: true,
            crestIcon: true,
            crestColor: true,
            crestSecondaryColor: true,
            crestBorderColor: true,
            crestImageUrl: true,
          },
        },
      },
    })

    const hasMore = listings.length > limit
    const page = hasMore ? listings.slice(0, limit) : listings
    const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null

    const items = page.map((listing) => ({
      id: listing.id,
      askingPrice: listing.askingPrice,
      expiresAt: listing.expiresAt,
      createdAt: listing.createdAt,
      isOwnListing: listing.sellingTeamId === teamId,
      player: listing.player,
      sellingTeam: listing.sellingTeam,
    }))

    return NextResponse.json({ items, nextCursor }, { status: 200 })
  } catch (error) {
    return handleTransferApiError(error)
  }
}
