"use client"

import { Stadium3D } from "@/components/stadium3d/Stadium3D"
import { computeSeatingDebugInfo } from "@/components/stadium3d/stadium-geometry"
import { computeStadium3DStructure } from "@/lib/stadium/stadium3d-config"

// Temporary, unlinked review page - comparing the four capacities the brief
// calls out (10k/30k/50k/70k) side by side, in the same visual language, per
// explicit instruction. Delete once Stadium3D is connected to a club's real
// capacity. 30,000 is the approved reference; the other three reuse the
// exact same config/mechanism (STADIUM_3D_ANCHORS, tier lookups, section
// layout, materials) - nothing capacity-specific was special-cased.
const CAPACITIES = [10_000, 30_000, 50_000, 70_000]

function StadiumCard({ capacity }: { capacity: number }) {
  const s = computeStadium3DStructure(capacity)
  const debug = computeSeatingDebugInfo(s)
  const coveragePct = Math.round((debug.estimatedSeats / capacity) * 100)

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b bg-muted/40 p-2">
        <div className="text-sm font-semibold">{capacity.toLocaleString()} capacity</div>
        <div className="text-xs text-muted-foreground">
          tier {s.tier} · tiers {s.tierCount} · depth {Math.round(s.standDepth)}m · height {Math.round(s.standHeight)}m ·
          roof {Math.round(s.roofCoverage * 100)}% · corner {Math.round(s.cornerFill * 100)}%
        </div>
        <div className="text-xs text-muted-foreground">
          sections {debug.longSideSections}×2L + {debug.shortSideSections}×2S + {debug.cornerSections}×4C ={" "}
          {debug.sectionCount} · rows {debug.rowCount} · vip {s.vipSections} · entrances {s.entranceCount}
        </div>
        <div className="text-xs font-medium">
          est. capacity {debug.estimatedSeats.toLocaleString()} ({coveragePct}%)
        </div>
      </div>
      <Stadium3D capacity={capacity} className="h-[380px] w-full" />
    </div>
  )
}

export default function Stadium3DDemoPage() {
  return (
    <div className="min-h-screen bg-background p-4">
      <h1 className="mb-1 text-xl font-bold">Stadium3D - capacity comparison</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        30,000 is the approved reference. 10,000 / 50,000 / 70,000 use the exact same mechanism - not connected to any
        real club yet.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {CAPACITIES.map((c) => (
          <StadiumCard key={c} capacity={c} />
        ))}
      </div>
    </div>
  )
}
