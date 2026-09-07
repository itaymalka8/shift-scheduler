"use client"

import { Stadium3D } from "@/components/stadium3d/Stadium3D"

// Internal capacity-comparison harness for developing Stadium3D - not a
// product page. Gated out of production by page.tsx; this file holds only
// the actual rendering, kept free of debug/internal metrics so there is
// nothing here to accidentally leave visible.
const CAPACITIES = [10_000, 30_000, 50_000, 70_000]

function StadiumCard({ capacity }: { capacity: number }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b bg-muted/40 p-2 text-sm font-semibold">{capacity.toLocaleString()}</div>
      <Stadium3D capacity={capacity} className="h-[380px] w-full" />
    </div>
  )
}

export function Stadium3DDemoClient() {
  return (
    <div className="min-h-screen bg-background p-4">
      <h1 className="mb-4 text-xl font-bold">Stadium3D - capacity comparison (dev only)</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {CAPACITIES.map((c) => (
          <StadiumCard key={c} capacity={c} />
        ))}
      </div>
    </div>
  )
}
