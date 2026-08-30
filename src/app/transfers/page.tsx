import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { TransfersMarketApp } from "./transfers-market-app"

// Same session/team resolution pattern as every other protected screen
// (squad, economy, club) - notFound() on either miss, matching
// middleware.ts's redirect-to-signin for the no-session case (this page is
// also listed in its matcher) and the app's default not-found page for the
// no-team case. The page itself never reads or writes any transfer data -
// TransfersMarketApp does everything through the existing read-only
// GET /api/transfers/listings, client-side.
export default async function TransfersPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) notFound()

  const team = await prisma.team.findUnique({ where: { userId: session.user.id } })
  if (!team) notFound()

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <TransfersMarketApp />
      </main>
    </div>
  )
}
