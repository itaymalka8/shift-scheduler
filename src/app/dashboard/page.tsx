import Image from "next/image"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { TeamCrest } from "@/components/team-crest"
import { SignOutButton } from "./sign-out-button"

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)

  const team = session?.user?.id
    ? await prisma.team.findUnique({ where: { userId: session.user.id } })
    : null

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-5xl flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Goalx Manager" width={40} height={40} className="rounded-full" />
            <span className="font-semibold text-lg">Goalx Manager</span>
          </div>
          <SignOutButton />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <TeamCrest
                shape={team?.crestShape}
                icon={team?.crestIcon}
                color={team?.crestColor}
                imageUrl={team?.crestImageUrl}
                size={56}
              />
              <div>
                <CardTitle className="text-2xl">
                  ברוכים הבאים, קבוצת {team?.name ?? session?.user?.teamName ?? ""}
                </CardTitle>
                <CardDescription>
                  שלום {session?.user?.name}, כאן יתנהל ניהול הקבוצה שלכם - הסגל,
                  הטקטיקה והליגה יגיעו בקרוב.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              ההרשמה וההתחברות שלכם עובדות מצוין. השלב הבא הוא בניית הסגל, מסך
              הטקטיקה ומנוע הליגה.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
