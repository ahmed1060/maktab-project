import { z } from "zod"

export const noteSchema = z.object({
    content: z.string().min(1, "Content is required"),
    attachment: z.union([z.string(), z.array(z.any())]).optional(),
    expiryDate: z.string().optional().nullable(),
    reminderDays: z.union([z.number(), z.string()]).optional().nullable(),
})

export type NoteInput = z.infer<typeof noteSchema>
