import { z } from "zod"

export const confirmMfaSchema = z.object({
    secret: z.string().min(1, "Secret is required"),
    code: z.string().min(6, "Invalid code").max(6, "Invalid code"),
})
export type ConfirmMfaInput = z.infer<typeof confirmMfaSchema>

export const disableMfaSchema = z.object({
    password: z.string().min(1, "Password is required"),
})
export type DisableMfaInput = z.infer<typeof disableMfaSchema>
