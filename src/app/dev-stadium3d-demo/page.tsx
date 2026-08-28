"use client"

import { Stadium3D } from "@/components/stadium3d/Stadium3D"
import { computeStadium3DStructure } from "@/lib/stadium/stadium3d-config"

// Temporary, unlinked review page - currently showing ONLY the 30,000
// reference capacity per explicit instruction, until that version is
// approved. Delete once Stadium3D is connected to a club's real capacity.
const REFERENCE_CAPACITY = 30_000

export default function Stadium3DDemoPage() {
  const s = computeStadium3DStructure(REFERENCE_CAPACITY)

  return (
    <div className="min-h-screen bg-background p-4">
      <h1 className="mb-1 text-xl font-bold">Stadium3D - 30,000 reference (visual pass 2)</h1>
      <p className="mb-1 text-sm text-muted-foreground">
        tier {s.tier} · sections {s.sectionCount} · visual rows {s.visualRowCount} (of {s.rowCount}) · depth{" "}
        {Math.round(s.standDepth)}m · height {Math.round(s.standHeight)}m · roof {Math.round(s.roofCoverage * 100)}% ·
        corner {Math.round(s.cornerFill * 100)}% · vip sections {s.vipSections} · entrances {s.entranceCount}
      </p>
      <p className="mb-4 text-sm text-muted-foreground">Not connected to any real club yet.</p>

      <div className="space-y-6">
        <div>
          <h2 className="mb-2 text-sm font-semibold">Desktop-width preview</h2>
          <div className="mx-auto overflow-hidden rounded-xl border bg-card" style={{ maxWidth: 900 }}>
            <Stadium3D capacity={REFERENCE_CAPACITY} className="h-[600px] w-full" />
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold">Mobile-width preview (375px)</h2>
          <div className="overflow-hidden rounded-xl border bg-card" style={{ width: 375 }}>
            <Stadium3D capacity={REFERENCE_CAPACITY} className="h-[420px] w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
