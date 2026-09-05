import { notFound } from "next/navigation"
import { Stadium3DDemoClient } from "./demo-client"

// Internal review harness, never meant for real users - not linked from any
// nav, and hard-blocked outside development so it can never be reached in a
// production deploy even if someone finds the URL.
export default function Stadium3DDemoPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <Stadium3DDemoClient />
}
