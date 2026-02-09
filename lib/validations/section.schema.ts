import { z } from "zod"

export const createSectionSchema = z.object({
    title: z.string().min(2, "Title must be at least 2 characters").max(100),
    clientId: z.string().min(1, "Client ID is required"),
})

export const updateSectionSchema = z.object({
    id: z.string().min(1, "Section ID is required"),
    title: z.string().min(2).max(100),
})

export type CreateSectionInput = z.infer<typeof createSectionSchema>
export type UpdateSectionInput = z.infer<typeof updateSectionSchema>
