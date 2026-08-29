import { notFound } from "next/navigation"
import { KitDemoClient } from "./demo-client"

// Internal review harness, never meant for real users - not linked from any
// nav, and hard-blocked outside development so it can never be reached in a
// production deploy even if someone finds the URL. Same pattern as
// /dev-stadium3d-demo. No database read or write anywhere on this page -
// pure local UI state, exactly as requested for this phase.
export default function KitDemoPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <KitDemoClient />
}
