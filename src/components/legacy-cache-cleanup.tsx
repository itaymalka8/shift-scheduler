"use client"

import { useEffect } from "react"

/**
 * This domain previously ran a different app (a police shift-scheduling
 * tool) before it was repurposed into Goalx Manager. If that app ever
 * registered a service worker in a visitor's browser, it keeps intercepting
 * navigations on this origin and can serve stale cached pages from the old
 * app - which is what "leaks through" after things like the sign-out
 * redirect. This runs once per page load and removes any such leftovers;
 * it's a no-op once a browser's already been cleaned up.
 */
export function LegacyCacheCleanup() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) registration.unregister()
      })
    }
    if ("caches" in window) {
      caches.keys().then((keys) => {
        for (const key of keys) caches.delete(key)
      })
    }
  }, [])

  return null
}
