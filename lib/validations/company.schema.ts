import { z } from "zod"

// Mirrors the TrialPreset database enum. Declared here rather than imported
// from @prisma/client so this module stays usable anywhere, including the
// creation form's live end-date preview.
export const trialPresetSchema = z.enum(['TWO_DAYS', 'SEVEN_DAYS', 'FOURTEEN_DAYS', 'ONE_MONTH', 'THREE_MONTHS'])

export const createCompanySchema = z.object({
    name: z.string().min(2, "Company name must be at least 2 characters").max(50),
    // Optional so an existing client that does not send it still works; the
    // service supplies the default rather than leaving the company with no
    // trial at all.
    trialPreset: trialPresetSchema.optional(),
    // Null means grandfathered — unrestricted. A company may be created without
    // a package and assigned one later.
    packageId: z.string().min(1).nullable().optional(),
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
    // Trial extension, in days, added on top of whichever preset was chosen.
    // A delta rather than a new total: "give them another week" is how the
    // request always arrives, and the column only ever grows.
    extendTrialDays: z.number().int().min(1).max(365).optional(),
})

export type CreateCompanyInput = z.infer<typeof createCompanySchema>
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>
