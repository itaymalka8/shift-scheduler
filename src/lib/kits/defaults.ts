import {
  DEFAULT_CREST_COLOR,
  DEFAULT_CREST_SECONDARY_COLOR,
  DEFAULT_CREST_BORDER_COLOR,
} from "@/components/team-crest"
import { DEFAULT_KIT_TEMPLATE, type KitTemplateId } from "@/lib/kits/templates"

export interface KitColors {
  template: KitTemplateId
  primaryColor: string
  secondaryColor: string
  accentColor: string
}

/**
 * What a club sees before it has ever saved a home kit - never written to
 * the database just because the club screen was opened. Derived from the
 * team's own crest colors (so a fresh preview already looks like "their"
 * colors) and falling back to the same GoalX defaults every new crest
 * starts with when a given crest color was never set.
 */
export function deriveDefaultHomeKit(crest: {
  color?: string | null
  secondaryColor?: string | null
  borderColor?: string | null
}): KitColors {
  return {
    template: DEFAULT_KIT_TEMPLATE,
    primaryColor: crest.color ?? DEFAULT_CREST_COLOR,
    secondaryColor: crest.secondaryColor ?? DEFAULT_CREST_SECONDARY_COLOR,
    accentColor: crest.borderColor ?? DEFAULT_CREST_BORDER_COLOR,
  }
}
