import { z } from "zod"

export const registerSchema = z
  .object({
    name: z.string().min(2, "השם חייב להכיל לפחות 2 תווים"),
    teamName: z.string().min(2, "שם הקבוצה חייב להכיל לפחות 2 תווים"),
    email: z.string().email("כתובת אימייל לא תקינה"),
    password: z.string().min(6, "הסיסמה חייבת להכיל לפחות 6 תווים"),
    confirmPassword: z.string(),
    crestShape: z.string().optional(),
    crestIcon: z.string().optional(),
    crestColor: z.string().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "הסיסמאות אינן תואמות",
    path: ["confirmPassword"],
  })

export type RegisterInput = z.infer<typeof registerSchema>

export const signInSchema = z.object({
  email: z.string().email("כתובת אימייל לא תקינה"),
  password: z.string().min(1, "יש להזין סיסמה"),
})

export type SignInInput = z.infer<typeof signInSchema>
