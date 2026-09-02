import { z } from "zod"

export const requestEmailCodeSchema = z.object({
    email: z.string().email("Invalid email address").max(254),
})
export type RequestEmailCodeInput = z.infer<typeof requestEmailCodeSchema>

export const confirmEmailCodeSchema = z.object({
    email: z.string().email("Invalid email address").max(254),
    code: z.string().min(6, "Invalid code").max(6, "Invalid code"),
})
export type ConfirmEmailCodeInput = z.infer<typeof confirmEmailCodeSchema>
