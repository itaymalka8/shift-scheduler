import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { deriveDefaultHomeKit } from "@/lib/kits/defaults"
import { isKitTemplateId } from "@/lib/kits/templates"
import { ClubApp } from "./club-app"

export default async function ClubPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) notFound()

  const team = await prisma.team.findUnique({ where: { userId: session.user.id } })
  if (!team) notFound()

  // Read-only: never creates a TeamKit row just because this page was
  // opened. A club that has never saved a home kit gets a derived preview
  // (from its own crest colors) instead - the real row only appears once
  // the manager actually clicks "save".
  const homeKit = await prisma.teamKit.findUnique({
    where: { teamId_type: { teamId: team.id, type: "HOME" } },
  })

  const defaults = deriveDefaultHomeKit({
    color: team.crestColor,
    secondaryColor: team.crestSecondaryColor,
    borderColor: team.crestBorderColor,
  })

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <h1 className="mb-6 text-2xl font-bold">המועדון שלי</h1>
        <ClubApp
          initialTemplate={isKitTemplateId(homeKit?.template) ? homeKit.template : defaults.template}
          initialPrimaryColor={homeKit?.primaryColor ?? defaults.primaryColor}
          initialSecondaryColor={homeKit?.secondaryColor ?? defaults.secondaryColor}
          initialAccentColor={homeKit?.accentColor ?? defaults.accentColor}
          crest={{
            shape: team.crestShape,
            pattern: team.crestPattern,
            color: team.crestColor,
            secondaryColor: team.crestSecondaryColor,
            borderColor: team.crestBorderColor,
            icon: team.crestIcon,
            imageUrl: team.crestImageUrl,
          }}
        />
      </main>
    </div>
  )
}
