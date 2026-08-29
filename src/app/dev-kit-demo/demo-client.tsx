"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CREST_COLORS, DEFAULT_CREST_SHAPE, DEFAULT_CREST_PATTERN, DEFAULT_CREST_ICON, DEFAULT_CREST_COLOR, DEFAULT_CREST_SECONDARY_COLOR, DEFAULT_CREST_BORDER_COLOR } from "@/components/team-crest"
import { JerseyPreview, KIT_TEMPLATES, DEFAULT_KIT_TEMPLATE, type KitTemplateId } from "@/components/kit/jersey-preview"
import { cn } from "@/lib/utils"

const PREVIEW_NUMBER = 10

// A real, already-existing default crest (the same defaults every new club
// starts with) - stands in for "a club that has a crest set". Toggled off
// below to also show the honest no-crest state; nothing here is invented
// crest data, just the app's own real default values.
const SAMPLE_CREST = {
  shape: DEFAULT_CREST_SHAPE,
  pattern: DEFAULT_CREST_PATTERN,
  icon: DEFAULT_CREST_ICON,
  color: DEFAULT_CREST_COLOR,
  secondaryColor: DEFAULT_CREST_SECONDARY_COLOR,
  borderColor: DEFAULT_CREST_BORDER_COLOR,
}

function ColorSwatchPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (color: string) => void
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2.5">
        {CREST_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            aria-pressed={value === c}
            onClick={() => onChange(c)}
            style={{ backgroundColor: c }}
            className={cn(
              "size-11 shrink-0 rounded-full border border-black/10 transition-all",
              value === c
                ? "ring-2 ring-offset-2 ring-primary ring-offset-background"
                : "opacity-70 active:opacity-100"
            )}
          />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground" dir="ltr">
        {value.toUpperCase()}
      </p>
    </div>
  )
}

export function KitDemoClient() {
  const [template, setTemplate] = useState<KitTemplateId>(DEFAULT_KIT_TEMPLATE)
  const [primaryColor, setPrimaryColor] = useState(CREST_COLORS[0])
  const [secondaryColor, setSecondaryColor] = useState(CREST_COLORS[12]) // white
  const [accentColor, setAccentColor] = useState(CREST_COLORS[6]) // amber
  const [showCrest, setShowCrest] = useState(true)
  const [savedFlash, setSavedFlash] = useState(false)

  const handleSave = () => {
    // Prototype only - no network call, no persistence. Real save wiring
    // (a single PATCH on click, per the product spec) lands once the data
    // model and route placement are approved.
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), 2000)
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10 lg:grid lg:grid-cols-[380px_1fr] lg:gap-8">
        {/* Preview - first in DOM order, so it's first on mobile too. */}
        <div className="lg:sticky lg:top-10 lg:self-start">
          <Card className="overflow-hidden border-primary/10">
            <CardHeader className="border-b bg-primary/5">
              <CardTitle className="text-base">חולצת הבית</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4 py-8">
              <JerseyPreview
                template={template}
                primaryColor={primaryColor}
                secondaryColor={secondaryColor}
                accentColor={accentColor}
                previewNumber={PREVIEW_NUMBER}
                crest={showCrest ? SAMPLE_CREST : null}
                size={260}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={showCrest} onChange={(e) => setShowCrest(e.target.checked)} />
                הצג סמל מועדון לדוגמה (לצורך בדיקה בלבד)
              </label>
            </CardContent>
          </Card>
        </div>

        {/* Controls */}
        <div className="mt-6 space-y-6 lg:mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">תבנית</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {KIT_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplate(t.id)}
                    aria-pressed={template === t.id}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-lg border p-3 transition-colors",
                      template === t.id
                        ? "border-primary bg-primary/10"
                        : "border-transparent bg-muted/40 hover:bg-muted"
                    )}
                  >
                    <JerseyPreview
                      template={t.id}
                      primaryColor={primaryColor}
                      secondaryColor={secondaryColor}
                      accentColor={accentColor}
                      size={56}
                    />
                    <span className="text-center text-xs font-medium leading-tight">{t.label}</span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">צבעים</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <ColorSwatchPicker label="צבע ראשי" value={primaryColor} onChange={setPrimaryColor} />
              <ColorSwatchPicker label="צבע משני" value={secondaryColor} onChange={setSecondaryColor} />
              <ColorSwatchPicker label="צבע הדגשה" value={accentColor} onChange={setAccentColor} />
            </CardContent>
          </Card>

          <Button size="lg" className="w-full" onClick={handleSave}>
            {savedFlash ? "נשמר! (הדגמה בלבד - אין שמירה אמיתית)" : "שמור חולצת בית"}
          </Button>
        </div>
      </div>
    </div>
  )
}
