import { z } from "zod"

const emailRegex = /^[^@]{1,20}@[^@]{1,10}\.com$/

export const createUserSchema = z.object({
    firstName: z.string().min(1).max(15, "First name too long"),
    lastName: z.string().min(1).max(15, "Last name too long"),
    email: z.string().regex(emailRegex, "Email format invalid (must be user(20)@domain(10).com)"),
    password: z.string().min(6).max(20, "Password must be 6-20 characters"),
    role: z.enum(['SUPER_ADMIN', 'ADMIN', 'TEAM_LEADER', 'EMPLOYEE']).optional().default('EMPLOYEE'),
    gender: z.enum(['MALE', 'FEMALE']).optional().default('MALE'),
    companyId: z.string().optional(),
    salary: z.coerce.number().min(0).optional().default(0),
    dayOffCredit: z.coerce.number().min(0).optional(),
    baseDayOffCredit: z.coerce.number().min(0).optional(),
    username: z.string().min(3).max(30).optional(),
})

export const updateUserSchema = createUserSchema.partial().extend({
    id: z.string().min(1, "User ID is required"),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DELETED', 'OFFLINE']).optional(),
    avatar: z.string().nullable().optional(),
})

export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
