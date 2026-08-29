import { TeamCrest } from "@/components/team-crest"

/**
 * Every home-kit template this phase supports. Pure data + a label - no
 * images, nothing that needs an asset. Rendering logic for each lives in
 * JerseyPreview below, driven entirely by primary/secondary/accent color.
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

interface JerseyPreviewProps {
  template: KitTemplateId
  primaryColor: string
  secondaryColor: string
  accentColor: string
  /** A shirt number shown purely to help judge how the kit will read on
   *  the pitch - not part of the kit definition itself. */
  previewNumber?: number
  /** Real crest props, straight from the team's own crest fields - never
   *  invented. Omit entirely when the club has no crest yet. */
  crest?: {
    shape?: string | null
    pattern?: string | null
    color?: string | null
    secondaryColor?: string | null
    borderColor?: string | null
    icon?: string | null
    imageUrl?: string | null
  } | null
  size?: number
  className?: string
}

// One shared silhouette (body + two sleeves) for every template - only the
// fill inside each region changes. Coordinates are illustrative, not traced
// from a real kit; the goal is a clean, recognizable jersey shape, not
// photorealism.
const BODY_PATH =
  "M82,40 L105,40 Q120,65 135,40 L158,40 L172,120 L185,245 Q120,255 55,245 L68,120 Z"
const COLLAR_TRIM_PATH = "M82,40 L105,40 Q120,65 135,40 L158,40"
const LEFT_SLEEVE_PATH = "M82,40 L45,55 L20,95 L45,115 L68,120 Z"
const RIGHT_SLEEVE_PATH = "M158,40 L195,55 L220,95 L195,115 L172,120 Z"

function BodyFill({ template, primary, secondary }: { template: KitTemplateId; primary: string; secondary: string }) {
  switch (template) {
    case "centralStripe":
      return (
        <>
          <rect x={0} y={0} width={240} height={260} fill={primary} />
          <rect x={106} y={0} width={28} height={260} fill={secondary} />
        </>
      )
    case "verticalStripes":
      return (
        <>
          <rect x={0} y={0} width={240} height={260} fill={primary} />
          {[58, 90, 122, 154].map((x) => (
            <rect key={x} x={x} y={0} width={16} height={260} fill={secondary} />
          ))}
        </>
      )
    case "horizontalStripes":
      return (
        <>
          <rect x={0} y={0} width={240} height={260} fill={primary} />
          {[55, 115, 175, 225].map((y) => (
            <rect key={y} x={0} y={y} width={240} height={22} fill={secondary} />
          ))}
        </>
      )
    case "halves":
      return (
        <>
          <rect x={0} y={0} width={120} height={260} fill={primary} />
          <rect x={120} y={0} width={120} height={260} fill={secondary} />
        </>
      )
    case "differentShoulders":
      return (
        <>
          <rect x={0} y={0} width={240} height={260} fill={primary} />
          <rect x={0} y={40} width={240} height={38} fill={secondary} />
        </>
      )
    case "diagonalStripe":
      return (
        <>
          <rect x={0} y={0} width={240} height={260} fill={primary} />
          <polygon points="55,40 100,40 205,245 160,245" fill={secondary} />
        </>
      )
    case "differentSleeves":
    case "solid":
    default:
      return <rect x={0} y={0} width={240} height={260} fill={primary} />
  }
}

/**
 * A single home-kit jersey, front view - built entirely from SVG shapes and
 * the three chosen colors. No bitmap, no per-combination asset: every
 * template/color combination renders from this one component.
 */
export function JerseyPreview({
  template,
  primaryColor,
  secondaryColor,
  accentColor,
  previewNumber,
  crest,
  size = 320,
  className,
}: JerseyPreviewProps) {
  const sleeveFill = template === "differentSleeves" ? secondaryColor : primaryColor

  return (
    <svg
      viewBox="0 0 240 260"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="תצוגה מקדימה של חולצת הבית"
    >
      <defs>
        <clipPath id="jersey-body-clip">
          <path d={BODY_PATH} />
        </clipPath>
      </defs>

      {/* Sleeves render first, body on top, so the shoulder seam has no gap. */}
      <path d={LEFT_SLEEVE_PATH} fill={sleeveFill} />
      <path d={RIGHT_SLEEVE_PATH} fill={sleeveFill} />

      <g clipPath="url(#jersey-body-clip)">
        <BodyFill template={template} primary={primaryColor} secondary={secondaryColor} />
      </g>

      {/* Accent trim: collar ring + a cuff band on each sleeve. */}
      <path d={COLLAR_TRIM_PATH} fill="none" stroke={accentColor} strokeWidth={7} strokeLinejoin="round" />
      <rect x={16} y={90} width={30} height={9} fill={accentColor} transform="rotate(-18 31 94)" />
      <rect x={194} y={90} width={30} height={9} fill={accentColor} transform="rotate(18 209 94)" />

      {crest ? (
        <foreignObject x={92} y={78} width={40} height={40}>
          <TeamCrest
            shape={crest.shape}
            pattern={crest.pattern}
            color={crest.color}
            secondaryColor={crest.secondaryColor}
            borderColor={crest.borderColor}
            icon={crest.icon}
            imageUrl={crest.imageUrl}
            size={40}
          />
        </foreignObject>
      ) : null}

      {previewNumber != null ? (
        <text
          x={120}
          y={190}
          textAnchor="middle"
          fontSize={64}
          fontWeight={700}
          fill={accentColor}
          stroke="rgba(0,0,0,0.15)"
          strokeWidth={1}
          fontFamily="var(--font-geist-sans), sans-serif"
        >
          {previewNumber}
        </text>
      ) : null}
    </svg>
  )
}
