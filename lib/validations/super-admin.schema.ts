import { z } from "zod"

export const superAdminSchema = z.object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email address"),
    username: z.string().min(3, "Username must be at least 3 characters").optional(),
    // F-16: floor raised from 8 to 12 for consistency with the regular
    // user schema; capped at 72 since bcrypt truncates beyond that.
    password: z.string().min(12, "Password must be at least 12 characters").max(72, "Password must be at most 72 characters"),
    gender: z.enum(['MALE', 'FEMALE']).optional(),
})

export type SuperAdminInput = z.infer<typeof superAdminSchema>

// Profile-only edit — no password (see SuperAdminService.update's comment)
// and no username, matching what the edit form actually collects.
export const superAdminUpdateSchema = z.object({
    firstName: z.string().min(1, "First name is required").optional(),
    lastName: z.string().min(1, "Last name is required").optional(),
    email: z.string().email("Invalid email address").optional(),
    gender: z.enum(['MALE', 'FEMALE']).optional(),
})

export type SuperAdminUpdateInput = z.infer<typeof superAdminUpdateSchema>
