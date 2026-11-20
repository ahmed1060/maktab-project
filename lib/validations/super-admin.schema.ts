import { z } from "zod"
import { usernameSchema } from "./username.schema"
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/new-employee-form"

export const superAdminSchema = z.object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email address"),
    // Optional: without one, they get one from their email (lib/username-rules.ts).
    username: usernameSchema.optional(),
    // F-16: the same floor as a person's, 8 since the owner's answer of
    // 2026-11-20 (PR 341); capped at 72 since bcrypt truncates beyond that.
    password: z.string().min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters`),
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
