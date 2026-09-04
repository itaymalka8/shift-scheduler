/**
 * A CLUB'S TROPHY CABINET.
 *
 * The same rows as the manager cabinet, entered from the other side: by
 * teamId, which is the champion's identity and the one thing about a club that
 * never changes.
 *
 * A CLUB KEEPS EVERY TITLE IT EVER WON, whoever was managing. A championship
 * won during a BOT era is a club championship - it belongs here, with no
 * manager credited, and never to whoever holds the club today. A championship
 * won during a HUMAN era shows that manager, resolved through the era the
 * title points at rather than through current ownership.
 */
import { prisma } from "@/lib/prisma"
import { CHAMPIONSHIP_SELECT, byMostRecent, toChampionshipView, type ChampionshipView } from "@/lib/trophies/championship"

export interface ClubChampionship extends ChampionshipView {
  /**
   * The manager who won it, or null when a bot era did.
   *
   * Null is the honest answer for a bot title: there was no manager. It is
   * never filled in with the club's current owner, and no fake bot user is
   * invented to occupy the space.
   */
  manager: { userId: string; name: string | null; image: string | null } | null
  /** True when a BOT era won it - the club's title, nobody's personal one. */
  wonUnderBot: boolean
}

const CLUB_HISTORY_SELECT = {
  ...CHAMPIONSHIP_SELECT,
  teamEra: {
    select: {
      id: true,
      type: true,
      userId: true,
      user: { select: { id: true, name: true, image: true } },
    },
  },
} as const

/** Every title this club has ever won, most recent first. */
export async function getClubTrophies(teamId: string, now: Date = new Date()): Promise<ClubChampionship[]> {
  const rows = await prisma.seasonChampion.findMany({
    where: { teamId },
    select: CLUB_HISTORY_SELECT,
  })

  return rows
    .map((row) => {
      const era = row.teamEra
      // A HUMAN era always names its manager (a database CHECK guarantees it),
      // so a missing user here means broken data - reported as "no manager"
      // rather than guessed at from anywhere else.
      const manager =
        era?.type === "HUMAN" && era.user ? { userId: era.user.id, name: era.user.name, image: era.user.image } : null
      return {
        ...toChampionshipView(row, now),
        manager,
        wonUnderBot: era?.type === "BOT",
      }
    })
    .sort(byMostRecent)
}

/** The club's current identity, for the page header. Explicitly the CURRENT name, not a historical one. */
export async function getClubIdentity(teamId: string) {
  return prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      countryCode: true,
      crestShape: true,
      crestPattern: true,
      crestIcon: true,
      crestColor: true,
      crestSecondaryColor: true,
      crestBorderColor: true,
      crestImageUrl: true,
    },
  })
}
