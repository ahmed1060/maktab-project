import { z } from "zod"

export const createProfileRequestSchema = z.object({
    newFirstName: z.string().min(2, "First name is too short").max(15, "First name is too long"),
    newLastName: z.string().min(2, "Last name is too short").max(15, "Last name is too long"),
})

export type CreateProfileRequestInput = z.infer<typeof createProfileRequestSchema>
