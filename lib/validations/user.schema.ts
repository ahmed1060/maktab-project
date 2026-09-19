import { z } from "zod"
import { partialWithoutDefaults } from "./partial-update"

export const createUserSchema = z.object({
    firstName: z.string().min(1).max(15, "First name too long"),
    lastName: z.string().min(1).max(15, "Last name too long"),
    // F-15: was a regex requiring `user(20)@domain(10).com` — rejected
    // most real addresses (anything not .com, any local part over 20
    // chars, any domain label over 10). A proper email format check plus a
    // generous length cap is what an email field actually needs.
    email: z.string().email("Invalid email address").max(254),
    // F-16: was capped at 20 — bcrypt truncates at 72 bytes, so there's no
    // technical reason for a ceiling that low; it only blocked password
    // managers and passphrases. Floor of 12 replaces the old floor of 8.
    password: z.string().min(12, "Password must be at least 12 characters").max(72, "Password must be at most 72 characters"),
    role: z.enum(['SUPER_ADMIN', 'ADMIN', 'TEAM_LEADER', 'EMPLOYEE']).optional().default('EMPLOYEE'),
    gender: z.enum(['MALE', 'FEMALE']).optional().default('MALE'),
    companyId: z.string().optional(),
    salary: z.coerce.number().min(0).optional().default(0),
    dayOffCredit: z.coerce.number().min(0).optional(),
    baseDayOffCredit: z.coerce.number().min(0).optional(),
    username: z.string().min(3).max(30).optional(),
})

export const updateUserSchema = partialWithoutDefaults(createUserSchema).extend({
    id: z.string().min(1, "User ID is required"),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DELETED', 'OFFLINE', 'ARCHIVED']).optional(),
    avatar: z.string().nullable().optional(),
    passcode: z.string().optional(),
    // P4: a salary change is effective-dated, so the answer to "this month or
    // next?" travels with it. Optional and defaulting to THIS_MONTH, which is
    // the behaviour that already existed — the new salary applies to the month
    // being worked. The screen that asks the question arrives in P7.
    salaryEffective: z.enum(['THIS_MONTH', 'NEXT_MONTH']).optional(),
    salaryReason: z.string().max(200).optional(),
})

export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
