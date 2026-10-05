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
    // A role of the company's, by id (ROLES_PLAN.md §6.4). When given it wins
    // over `role`, which then only says what kind — the base role comes from
    // the role itself.
    roleId: z.string().min(1).optional(),
    gender: z.enum(['MALE', 'FEMALE']).optional().default('MALE'),
    companyId: z.string().optional(),
    salary: z.coerce.number().min(0).optional().default(0),
    dayOffCredit: z.coerce.number().min(0).optional(),
    baseDayOffCredit: z.coerce.number().min(0).optional(),
    username: z.string().min(3).max(30).optional(),
    // Nullable as well as optional, and the difference matters: absent means
    // "leave it alone", null means "unassign", and an Admin resolving a
    // hand-off needs to be able to say the second one. partialWithoutDefaults
    // below would have turned an omitted field into a create-time default if
    // this had one — it deliberately does not.
    teamLeaderId: z.string().min(1).nullable().optional(),
})

export const updateUserSchema = partialWithoutDefaults(createUserSchema).extend({
    id: z.string().min(1, "User ID is required"),
    status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DELETED', 'OFFLINE', 'ARCHIVED']).optional(),
    avatar: z.string().nullable().optional(),
    // P4: a salary change is effective-dated, so the answer to "this month or
    // next?" travels with it. Optional and defaulting to THIS_MONTH, which is
    // the behaviour that already existed — the new salary applies to the month
    // being worked. The screen that asks the question arrives in P7.
    salaryEffective: z.enum(['THIS_MONTH', 'NEXT_MONTH']).optional(),
    salaryReason: z.string().max(200).optional(),
    // The answer to "where do this leader's team members go?", supplied only
    // when the change would strip their leadership. Three states again, and
    // all three are meaningful: absent means nobody has answered yet, so the
    // change is refused; null means unassign them; an id means move them to
    // that leader.
    reassignReportsTo: z.string().min(1).nullable().optional(),
    // With a role change, the role is held until this instant and then they
    // return to the one they had (ROLES_PLAN.md §6.13). Null keeps a cover
    // role for good — nothing returns them; absent leaves it alone.
    actingUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date, YYYY-MM-DD").nullable().optional(),
})

export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
