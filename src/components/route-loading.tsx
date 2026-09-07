import Image from "next/image"

/**
 * The one route-transition loading UI for every screen in the game - used
 * via each top-level route's loading.tsx (Next's built-in Suspense
 * boundary), never a custom router-bypassing overlay. Deliberately light:
 * a small mark + a subtle ring, not the full-screen loader auth flows use -
 * this only needs to say "your click landed," not hold the screen.
 */
export function RouteLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
      <div className="relative flex size-14 items-center justify-center">
        <div className="absolute inset-0 rounded-full border-2 border-primary/15 border-t-primary motion-safe:animate-spin" />
        <Image src="/logo.png" alt="" width={26} height={26} className="rounded-full opacity-80" />
      </div>
    </div>
  )
}
