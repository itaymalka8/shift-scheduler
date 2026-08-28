"use client"

import { Stadium3D } from "@/components/stadium3d/Stadium3D"
import { computeStadium3DStructure } from "@/lib/stadium/stadium3d-config"

// Temporary, unlinked comparison page for the four Stadium3D demo capacities
// - not wired into the real /stadium screen yet. Delete once the look is
// approved and Stadium3D is connected to a club's real capacity.
const DEMO_CAPACITIES = [10_000, 30_000, 50_000, 70_000]

export default function Stadium3DDemoPage() {
  return (
    <div className="min-h-screen bg-background p-4">
      <h1 className="mb-1 text-xl font-bold">Stadium3D - Demo Comparison</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Same camera framing principle, auto-scaled per capacity. Not connected to any real club yet.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {DEMO_CAPACITIES.map((capacity) => {
          const s = computeStadium3DStructure(capacity)
          return (
            <div key={capacity} className="overflow-hidden rounded-xl border bg-card">
              <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-sm">
                <span className="font-semibold">{capacity.toLocaleString()} · {s.tier}</span>
                <span className="text-xs text-muted-foreground">
                  tiers {s.tierCount} · rows {s.rowCount} · depth {Math.round(s.standDepth)}m · height{" "}
                  {Math.round(s.standHeight)}m · roof {Math.round(s.roofCoverage * 100)}% · corner{" "}
                  {Math.round(s.cornerFill * 100)}%
                </span>
              </div>
              <Stadium3D capacity={capacity} className="h-[420px] w-full" />
            </div>
          )
        })}
      </div>
    </div>
  )
}
