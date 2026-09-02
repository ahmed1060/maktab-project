import { z } from "zod"

export const forgotPasswordRequestSchema = z.object({
    email: z.string().email("Invalid email address").max(254),
})
export type ForgotPasswordRequestInput = z.infer<typeof forgotPasswordRequestSchema>

export const forgotPasswordConfirmSchema = z.object({
    email: z.string().email("Invalid email address").max(254),
    code: z.string().min(6, "Invalid code").max(6, "Invalid code"),
    // F-16: same 12-72 floor/ceiling as every other password-setting path.
    newPassword: z.string().min(12, "Password must be at least 12 characters").max(72, "Password must be at most 72 characters"),
})
export type ForgotPasswordConfirmInput = z.infer<typeof forgotPasswordConfirmSchema>
