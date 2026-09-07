// Pure, environment-agnostic pieces of Display Mode - importable from both
// server code (the root layout's generateViewport, which reads the cookie
// before any HTML is sent) and client code (the provider/switcher). Kept in
// its own file, with no "use client", specifically because a "use client"
// module can't have its plain exports called from server code (only
// rendered as a component) - see display-mode-context.tsx for the
// React/browser half of this feature, mirroring how translations.ts vs
// locale-context.tsx already split the same way for i18n.

// Three modes, no fourth: "auto" preserves today's behavior exactly (real
// viewport decides), "mobile"/"desktop" force one of Tailwind's own two
// layouts regardless of the physical screen. There is no separate desktop
// layout to build - every screen already renders both a mobile and a
// desktop arrangement side by side, switched purely by CSS breakpoints
// (see GoalXNavigation's `md:hidden` / `hidden md:block`, and every other
// screen's `sm:`/`md:`/`lg:` classes - confirmed there is zero JS-based
// width/device detection anywhere in the app). Forcing a mode is therefore
// just a matter of making the browser report a different viewport width,
// never a second component tree.
export type DisplayMode = "auto" | "mobile" | "desktop"

export function isDisplayMode(value: string | null | undefined): value is DisplayMode {
  return value === "auto" || value === "mobile" || value === "desktop"
}

export const DISPLAY_MODE_COOKIE = "goalx-display-mode"

// The CSS width "desktop" pins the viewport to. The app's widest real
// breakpoint is Tailwind's `lg` (1024) - there is no `xl`/`2xl` usage
// anywhere in the codebase, confirmed by grep, so anything at or above
// 1024 activates the exact same desktop layout (e.g. the tactics screen's
// side-by-side pitch + settings panel). 1080 keeps a deliberate safety
// margin above that 1024 boundary (rather than sitting exactly on it)
// while still giving a meaningfully larger effective on-screen size than
// 1280 once the phone's browser zooms the whole layout to fit its screen.
export const DESKTOP_VIEWPORT_WIDTH = 1080
// Comfortably narrower than Tailwind's `sm` (640) so "mobile" mode reliably
// stays under every breakpoint the app uses, even on a wide phone or a
// resized desktop window.
export const MOBILE_VIEWPORT_WIDTH = 390
