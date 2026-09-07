/**
 * Every home-kit template this phase supports - pure data, no images,
 * nothing that needs an asset. This is the one source of truth for what a
 * valid template id is: UI (JerseyPreview) and server code (the club-kit
 * API route) both import from here, so neither has to reach into the
 * other's layer just to validate a string.
 */
export const KIT_TEMPLATES = [
  { id: "solid", label: "חולצה חלקה" },
  { id: "centralStripe", label: "פס אנכי מרכזי" },
  { id: "verticalStripes", label: "פסים אנכיים" },
  { id: "horizontalStripes", label: "פסים אופקיים" },
  { id: "halves", label: "חצי חצי" },
  { id: "differentSleeves", label: "שרוולים בצבע שונה" },
  { id: "differentShoulders", label: "כתפיים בצבע שונה" },
  { id: "diagonalStripe", label: "פס אלכסוני" },
] as const

export type KitTemplateId = (typeof KIT_TEMPLATES)[number]["id"]

export function isKitTemplateId(value: string | null | undefined): value is KitTemplateId {
  return !!value && KIT_TEMPLATES.some((t) => t.id === value)
}

export const DEFAULT_KIT_TEMPLATE: KitTemplateId = "solid"
