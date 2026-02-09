import { z } from "zod"

export const superAdminSchema = z.object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email address"),
    username: z.string().min(3, "Username must be at least 3 characters").optional(),
    password: z.string().min(6, "Password must be at least 6 characters"),
    gender: z.enum(['MALE', 'FEMALE']).optional(),
})

export type SuperAdminInput = z.infer<typeof superAdminSchema>
