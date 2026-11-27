import { z } from "zod"
import { partialWithoutDefaults } from "./partial-update"
import { usernameSchema } from "./username.schema"
import { NAME_MAX, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/new-employee-form"
import { arabicName } from "./arabic-name.schema"
import { hasArabic } from "@/lib/names"

export const createUserSchema = z.object({
    firstName: z.string().min(1).max(NAME_MAX, "First name too long"),
    lastName: z.string().min(1).max(NAME_MAX, "Last name too long"),
    // Their names in Arabic (LATER_CHANGES_PLAN.md §3, PR 398), beside the
    // English ones above: needed for someone new (newUserSchema, PR 402).
    firstNameAr: arabicName(1, NAME_MAX).optional(),
    lastNameAr: arabicName(1, NAME_MAX).optional(),
    // F-15: was a regex requiring `user(20)@domain(10).com` — rejected
    // most real addresses (anything not .com, any local part over 20
    // chars, any domain label over 10). A proper email format check plus a
    // generous length cap is what an email field actually needs.
    email: z.string().email("Invalid email address").max(254),
    // F-16: was capped at 20 — bcrypt truncates at 72 bytes, so there's no
    // technical reason for a ceiling that low; it only blocked password
    // managers and passphrases. The floor is 8, the owner's answer of
    // 2026-11-20 (PR 341), where it had been raised to 12: one rule with
    // every screen's (lib/new-employee-form.ts).
    password: z.string().min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters`),
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
    username: usernameSchema.optional(),
    // Nullable as well as optional, and the difference matters: absent means
    // "leave it alone", null means "unassign", and an Admin resolving a
    // hand-off needs to be able to say the second one. partialWithoutDefaults
    // below would have turned an omitted field into a create-time default if
    // this had one — it deliberately does not.
    teamLeaderId: z.string().min(1).nullable().optional(),
})

/**
 * Someone new (POST /api/users): each name in English and in Arabic, both
 * needed, each in its own letters (LATER_CHANGES_PLAN.md §3.1, step 4a, PR
 * 402; DESIGN.md §5.3). An edit takes the names as createUserSchema does,
 * as one saved before in one language is asked for the other on its next
 * edit, not refused (step 4b).
 */
const inEnglish = z.string().trim().min(1).max(NAME_MAX).refine(name => !hasArabic(name), "Written in English letters")
export const newUserSchema = createUserSchema.extend({
    firstName: inEnglish,
    lastName: inEnglish,
    firstNameAr: arabicName(1, NAME_MAX),
    lastNameAr: arabicName(1, NAME_MAX),
    // When their contract starts, a date in the company's calendar, today
    // unless given (LATER_CHANGES_PLAN.md §7.2, PR 425). Changed later on its
    // own route, never by an edit, so only someone new takes it.
    contractStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date, YYYY-MM-DD").optional(),
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
    // The month the choice was shown for, its "this month" (LATER_CHANGES_PLAN.md
    // §7.13, Codex review on PR 437): a page left open past the 1st still
    // means the months it named.
    salaryMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
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
    // With a new password of one's own, the one it replaces (PR 229). Up to
    // bcrypt's 72 bytes and then some: one set before today's limits is
    // checked as typed, not refused for its length.
    currentPassword: z.string().max(256).optional(),
    // With somebody else's new password or email, the saver's own (PR 231).
    confirmPassword: z.string().max(256).optional(),
    // Their WhatsApp number, for their clients (CLIENT_PORTAL_PLAN.md §7,
    // PR 340), as it was typed: the service reads it (lib/whatsapp-number.ts)
    // and keeps it with its country code. Null or empty takes it away; absent
    // leaves it as it is, as the profile's own form doesn't send it.
    whatsappNumber: z.string().max(40).nullable().optional(),
})

export type CreateUserInput = z.infer<typeof createUserSchema> & { contractStart?: string }
export type UpdateUserInput = z.infer<typeof updateUserSchema>
