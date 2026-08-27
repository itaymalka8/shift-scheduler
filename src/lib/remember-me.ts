// "Remember me" is enforced entirely client-side: NextAuth's JWT session
// cookie always persists for the same global duration (see session.maxAge in
// lib/auth.ts) - there's no clean way to vary that per sign-in. Instead we
// detect whether the browser was actually closed and reopened:
// sessionStorage survives reloads/navigation but is cleared when the browser
// fully closes, while localStorage persists forever. If the user didn't ask
// to be remembered and the sessionStorage marker is gone, the browser was
// closed since they logged in, so we sign them out.

const REMEMBER_KEY = "goalx-remember"
const SESSION_ACTIVE_KEY = "goalx-session-active"

export function markLoginRemember(remember: boolean) {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? "true" : "false")
    sessionStorage.setItem(SESSION_ACTIVE_KEY, "1")
  } catch {
    // Storage can throw in private browsing / disabled-storage contexts - ignore.
  }
}

export function shouldForceSignOut(): boolean {
  try {
    const remember = localStorage.getItem(REMEMBER_KEY)
    if (remember !== "false") return false
    return sessionStorage.getItem(SESSION_ACTIVE_KEY) !== "1"
  } catch {
    return false
  }
}

export function clearRememberState() {
  try {
    localStorage.removeItem(REMEMBER_KEY)
    sessionStorage.removeItem(SESSION_ACTIVE_KEY)
  } catch {
    // ignore
  }
}
