import { z } from "zod"

export const createCompanySchema = z.object({
    name: z.string().min(2, "Company name must be at least 2 characters").max(50),
})

export const updateCompanySchema = z.object({
    id: z.string().min(1, "Company ID is required"),
    name: z.string().min(2).max(50).optional(),
    isBanned: z.boolean().optional(),
})

export type CreateCompanyInput = z.infer<typeof createCompanySchema>
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>
