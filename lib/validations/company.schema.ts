import { z } from "zod"

export const createCompanySchema = z.object({
    name: z.string().min(2, "Company name must be at least 2 characters").max(50),
})

export const updateCompanySchema = z.object({
    id: z.string().min(1, "Company ID is required"),
    name: z.string().min(2).max(50).optional(),
    isBanned: z.boolean().optional(),
    // Company Settings: whether task-location auto-verify runs at all for
    // this company's tasks. See the matching comment on the Company model.
    autoVerifyLocation: z.boolean().optional(),
    // Vendors feature: custom label for the Vendors tab. Empty string is
    // treated the same as omitting it (reset to the default) rather than
    // stored literally — see the PUT handler.
    vendorsLabel: z.string().max(50).optional().nullable(),
})

export type CreateCompanyInput = z.infer<typeof createCompanySchema>
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>
