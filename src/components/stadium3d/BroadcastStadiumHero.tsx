"use client"

import dynamic from "next/dynamic"
import { StadiumIllustration } from "@/components/stadium-illustration"
import { Stadium3DErrorBoundary } from "./Stadium3DErrorBoundary"

// The Three.js/R3F bundle is fetched only once this actually mounts, so the
// Match Center's initial payload stays the same as before the 3D scene existed.
const BroadcastStadium = dynamic(() => import("./BroadcastStadium").then((m) => m.BroadcastStadium), {
  ssr: false,
  loading: () => <LoadingState />,
})

function LoadingState() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#06050F]">
      <div className="size-8 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
    </div>
  )
}

/**
 * The lightweight fallback, used when WebGL is unavailable or the 3D scene
 * fails to initialise: the SVG stadium, driven by the same stadiumStyle,
 * capacity, crowd style and club colours. It is deliberately the SAME visual
 * language (night bowl, club-coloured crowd, LED strip) so a device that
 * can't run the scene still gets a coherent match screen rather than a hole.
 */
function LightweightFallback({
  capacity,
  stadiumStyle,
  crowdStyle,
  primaryColor,
  secondaryColor,
}: {
  capacity: number
  stadiumStyle: string | null
  crowdStyle: "calm" | "ultras"
  primaryColor?: string | null
  secondaryColor?: string | null
}) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#06050F]">
      <StadiumIllustration
        style={stadiumStyle}
        capacity={capacity}
        crowdStyle={crowdStyle}
        primaryColor={primaryColor}
        secondaryColor={secondaryColor}
        className="h-full w-full"
      />
    </div>
  )
}

export function BroadcastStadiumHero({
  capacity,
  stadiumStyle,
  crowdStyle = "calm",
  primaryColor,
  secondaryColor,
  className,
}: {
  capacity: number
  stadiumStyle: string | null
  crowdStyle?: "calm" | "ultras"
  primaryColor?: string | null
  secondaryColor?: string | null
  className?: string
}) {
  return (
    <div className={className}>
      <Stadium3DErrorBoundary
        fallback={
          <LightweightFallback
            capacity={capacity}
            stadiumStyle={stadiumStyle}
            crowdStyle={crowdStyle}
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
          />
        }
      >
        <BroadcastStadium
          capacity={capacity}
          stadiumStyle={stadiumStyle}
          crowdStyle={crowdStyle}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          className="h-full w-full"
        />
      </Stadium3DErrorBoundary>
    </div>
  )
}
