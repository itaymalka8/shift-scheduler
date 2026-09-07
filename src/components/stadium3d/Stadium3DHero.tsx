"use client"

import dynamic from "next/dynamic"
import { Stadium3DErrorBoundary } from "./Stadium3DErrorBoundary"

const Stadium3D = dynamic(() => import("./Stadium3D").then((m) => m.Stadium3D), {
  ssr: false,
  loading: () => <LoadingState />,
})

function LoadingState() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#DCE0EC]">
      <div className="size-8 animate-spin rounded-full border-2 border-white/40 border-t-white" />
    </div>
  )
}

/** A simple, non-broken fallback for browsers/devices that can't create a WebGL context. */
function UnsupportedFallback({ capacity }: { capacity: number }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[#DCE0EC] text-[#3B2F7A]">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="opacity-60">
        <rect x="3" y="8" width="18" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 8L12 4L21 8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <div className="text-sm font-medium">{capacity.toLocaleString()}</div>
    </div>
  )
}

/**
 * The stadium hero as actually embedded on the real /stadium page - lazy
 * loaded (the Three.js/R3F chunk is only fetched once this component
 * mounts), with a clean spinner while it loads and a plain fallback (no
 * broken canvas) if WebGL itself fails. Non-interactive: this is a hero
 * visual on a data page, not a dedicated 3D viewer - OrbitControls would
 * capture touch-drag gestures that start on the canvas, which on mobile
 * would fight the page's own vertical scroll.
 */
export function Stadium3DHero({ capacity, className }: { capacity: number; className?: string }) {
  return (
    <div className={className}>
      <Stadium3DErrorBoundary fallback={<UnsupportedFallback capacity={capacity} />}>
        <Stadium3D capacity={capacity} interactive={false} className="h-full w-full" />
      </Stadium3DErrorBoundary>
    </div>
  )
}
