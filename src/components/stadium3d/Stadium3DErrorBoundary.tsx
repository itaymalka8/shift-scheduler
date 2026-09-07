"use client"

import { Component, type ReactNode } from "react"

/**
 * Catches WebGL/Three.js init failures (unsupported browser, context creation
 * refused, driver blocklist) so a broken 3D canvas shows a simple fallback
 * instead of taking down the whole stadium page. Must be a class component -
 * React only supports catching render/commit errors via getDerivedStateFromError,
 * which has no hook equivalent.
 */
export class Stadium3DErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
