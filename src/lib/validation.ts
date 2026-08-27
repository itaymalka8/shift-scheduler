import { z } from "zod"
import type { TranslationKey } from "@/lib/i18n/translations"

type T = (key: TranslationKey) => string

export function makeAccountSchema(t: T) {
  return z
    .object({
      name: z.string().min(2, t("validation.nameMin")),
      teamName: z.string().min(2, t("validation.teamNameMin")),
      email: z.string().email(t("validation.emailInvalid")),
      password: z.string().min(6, t("validation.passwordMin")),
      confirmPassword: z.string(),
      crestShape: z.string().optional(),
      crestPattern: z.string().optional(),
      crestIcon: z.string().optional(),
      crestColor: z.string().optional(),
      crestSecondaryColor: z.string().optional(),
      crestBorderColor: z.string().optional(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t("validation.passwordMismatch"),
      path: ["confirmPassword"],
    })
}

export type AccountInput = z.infer<ReturnType<typeof makeAccountSchema>>

export const CROWD_STYLES = ["calm", "ultras"] as const
export type CrowdStyle = (typeof CROWD_STYLES)[number]

export function makeTeamDetailsSchema(t: T) {
  return z.object({
    countryCode: z.string().min(1, t("validation.countryRequired")),
    city: z.string().min(1, t("validation.cityRequired")),
    stadiumName: z.string().min(1, t("validation.stadiumNameMin")),
    stadiumStyle: z.string().optional(),
    crowdStyle: z.enum(CROWD_STYLES),
  })
}

export type TeamDetailsInput = z.infer<ReturnType<typeof makeTeamDetailsSchema>>

export function makeSignInSchema(t: T) {
  return z.object({
    email: z.string().email(t("validation.emailInvalid")),
    password: z.string().min(1, t("validation.passwordRequired")),
  })
}

export type SignInInput = z.infer<ReturnType<typeof makeSignInSchema>>
