"use client"

import { BroadcastStadiumHero } from "@/components/stadium3d/BroadcastStadiumHero"
import type { HomeMatchTeamView } from "./types"

/**
 * The stadium the match is played in, rendered as a real 3D broadcast scene
 * (see components/stadium3d/BroadcastStadium.tsx) from the home club's own
 * stadiumStyle, capacity, crowd style and colours.
 *
 * This is the hero of the Match Center - the scoreboard and everything below
 * it sit on top of this scene, not in a separate card beside it.
 */
export function StadiumBackdrop({ homeTeam, celebrating }: { homeTeam: HomeMatchTeamView; celebrating: boolean }) {
  const accent = homeTeam.crestColor ?? "#5D4890"
  const accent2 = homeTeam.crestSecondaryColor ?? "#D3CEDD"

  return (
    <div className="relative h-full w-full">
      <BroadcastStadiumHero
        capacity={homeTeam.stadiumCapacity ?? 12_000}
        stadiumStyle={homeTeam.stadiumStyle}
        crowdStyle={homeTeam.crowdStyle === "ultras" ? "ultras" : "calm"}
        primaryColor={accent}
        secondaryColor={accent2}
        className="h-full w-full"
      />

      {/* A brief wash of club colour over the whole scene when a goal lands -
          the cheapest possible "the ground erupts" cue, and the only moment
          any heavy effect is spent. */}
      {celebrating && (
        <div
          className="pointer-events-none absolute inset-0 animate-goalx-crowd-flash"
          style={{ background: `radial-gradient(circle at 50% 62%, ${accent}66, transparent 68%)` }}
        />
      )}

      {/* Grades the scene into the panel below it, so the hero has no hard
          bottom edge cutting across the broadcast. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#0B0917] via-[#0B0917]/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/45 to-transparent" />
    </div>
  )
}
