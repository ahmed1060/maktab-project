import { z } from "zod"
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/new-employee-form"

export const forgotPasswordRequestSchema = z.object({
    email: z.string().email("Invalid email address").max(254),
})
export type ForgotPasswordRequestInput = z.infer<typeof forgotPasswordRequestSchema>

export const forgotPasswordConfirmSchema = z.object({
    email: z.string().email("Invalid email address").max(254),
    code: z.string().min(6, "Invalid code").max(6, "Invalid code"),
    // F-16: the same floor and ceiling as every other password-setting path
    // (8 to 72 since PR 341).
    newPassword: z.string().min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters`),
})
export type ForgotPasswordConfirmInput = z.infer<typeof forgotPasswordConfirmSchema>
