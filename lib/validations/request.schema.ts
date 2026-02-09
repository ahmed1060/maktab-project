import { z } from "zod"

export const createRequestSchema = z.object({
    title: z.string().min(3, "Title must be at least 3 characters").max(100, "Title cannot exceed 100 characters"),
    details: z.string().min(10, "Details must be at least 10 characters").max(1000, "Details cannot exceed 1000 characters"),
    companyId: z.string().optional(),
})

export type CreateRequestInput = z.infer<typeof createRequestSchema>
