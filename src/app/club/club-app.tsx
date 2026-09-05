"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CREST_COLORS } from "@/components/team-crest"
import { JerseyPreview } from "@/components/kit/jersey-preview"
import { KIT_TEMPLATES, type KitTemplateId } from "@/lib/kits/templates"
import { cn } from "@/lib/utils"

const PREVIEW_NUMBER = 10

interface CrestProps {
  shape?: string | null
  pattern?: string | null
  color?: string | null
  secondaryColor?: string | null
  borderColor?: string | null
  icon?: string | null
  imageUrl?: string | null
}

interface ClubAppProps {
  initialTemplate: KitTemplateId
  initialPrimaryColor: string
  initialSecondaryColor: string
  initialAccentColor: string
  crest: CrestProps
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

export function ClubApp({
  initialTemplate,
  initialPrimaryColor,
  initialSecondaryColor,
  initialAccentColor,
  crest,
}: ClubAppProps) {
  const [template, setTemplate] = useState<KitTemplateId>(initialTemplate)
  const [primaryColor, setPrimaryColor] = useState(initialPrimaryColor)
  const [secondaryColor, setSecondaryColor] = useState(initialSecondaryColor)
  const [accentColor, setAccentColor] = useState(initialAccentColor)
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")

  const handleSave = async () => {
    setStatus("saving")
    try {
      const res = await fetch("/api/club/kit", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, primaryColor, secondaryColor, accentColor }),
      })
      if (!res.ok) throw new Error("save failed")
      setStatus("saved")
      window.setTimeout(() => setStatus("idle"), 2000)
    } catch {
      setStatus("error")
    }
  }

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">זהות המועדון</h2>
      <div className="lg:grid lg:grid-cols-[380px_1fr] lg:gap-8">
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
                crest={crest}
                size={260}
              />
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

          <Button size="lg" className="w-full" onClick={handleSave} disabled={status === "saving"}>
            {status === "saving"
              ? "שומר..."
              : status === "saved"
                ? "נשמר!"
                : status === "error"
                  ? "השמירה נכשלה - נסה שוב"
                  : "שמור חולצת בית"}
          </Button>
        </div>
      </div>
    </section>
  )
}
