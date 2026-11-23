import { z } from "zod"
import { NAME_MAX } from "@/lib/new-employee-form"

export const createProfileRequestSchema = z.object({
    newFirstName: z.string().min(2, "First name is too short").max(NAME_MAX, "First name is too long"),
    newLastName: z.string().min(2, "Last name is too short").max(NAME_MAX, "Last name is too long"),
})

export type CreateProfileRequestInput = z.infer<typeof createProfileRequestSchema>
