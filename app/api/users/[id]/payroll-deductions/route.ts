import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions/can"
import { verifyResourceAccess } from "@/lib/security"
import { sessionHasModule } from "@/lib/features/require"
import { assertStepUp } from "@/lib/step-up"
import { DeductionsChanged, PersonDeductionService, PersonDeductionsInvalid } from "@/lib/services/person-deduction.service"
import type { PersonDeductionDraft } from "@/lib/payroll-deductions"

/**
 * A person's payroll deductions (LATER_CHANGES_PLAN.md §7.12, step 9b, PR
 * 442; DESIGN.md §5.5, A person's payroll deductions), their profile's card.
 * Asked what their salary is asked (lib/profile-access.ts): read by whoever
 * sees salaries over them, and on one's own; saved by whoever may change
 * their salary, never one's own, with the code a salary change asks for.
 * Never an Admin's, whose pay isn't on the profile, and only where the
 * company's package has Payroll.
 */

/** Whose pay is on the profile: an employee's or a Team Leader's. */
const PAID = ["EMPLOYEE", "TEAM_LEADER"]

async function personOf(id: string) {
    const person = await prisma.user.findUnique({ where: { id }, select: { id: true, companyId: true, teamLeaderId: true, role: true } })
    return person ? { ...person, target: { companyId: person.companyId, userId: person.id, teamLeaderId: person.teamLeaderId } } : null
}

export const GET = withStandardHandler(async (req, session, json, { params }) => {
    const userId: string = params.id
    if (!sessionHasModule(session, "PAYROLL")) return ApiResponse.forbidden()
    const person = await personOf(userId)
    if (!person) return ApiResponse.notFound("User not found")
    if (!PAID.includes(person.role)) return ApiResponse.forbidden()
    if (session.user.id !== userId) {
        if (!can(session.user, "salary.view") || !can(session.user, "salary.view", person.target)) return ApiResponse.forbidden()
        if (!await verifyResourceAccess(session, userId, "USER", "salary.view")) return ApiResponse.forbidden()
    }
    return ApiResponse.success(await PersonDeductionService.view(userId))
})

const MODES = ["COMPANY", "OWN", "NONE"] as const

export const PUT = withStandardHandler(async (req, session, json, { params }) => {
    const userId: string = params.id
    if (!sessionHasModule(session, "PAYROLL")) return ApiResponse.forbidden()
    const person = await personOf(userId)
    if (!person) return ApiResponse.notFound("User not found")
    if (!PAID.includes(person.role)) return ApiResponse.forbidden()
    // Never one's own: can() refuses salary.edit on the caller (ROLES_PLAN.md §4.2, rule 5).
    if (!can(session.user, "salary.edit") || !can(session.user, "salary.edit", person.target)) return ApiResponse.forbidden()
    if (!await verifyResourceAccess(session, userId, "USER", "salary.edit")) return ApiResponse.forbidden()

    const body = (json ?? {}) as Record<string, unknown>
    if (!Array.isArray(body.deductions)) return ApiResponse.badRequest("deductions is required")
    const deductions: PersonDeductionDraft[] = body.deductions.map((d: any) => ({
        ref: typeof d?.ref === "string" ? d.ref : "",
        basis: d?.basis === "AMOUNT" ? "AMOUNT" : "PERCENT",
        mode: MODES.includes(d?.mode) ? d.mode : "COMPANY",
        value: typeof d?.value === "number" ? String(d.value) : typeof d?.value === "string" ? d.value : "",
    }))

    // Changing someone's pay is high-risk (ROLES_PLAN.md §6.15), as their salary is.
    await assertStepUp(session, "salary.edit")
    try {
        return ApiResponse.success(await PersonDeductionService.save(userId, deductions, session))
    } catch (error) {
        // What's wrong, under each deduction, as the card says it.
        if (error instanceof PersonDeductionsInvalid) return ApiResponse.badRequest("Validation Error", { code: "DEDUCTIONS_INVALID", errors: error.errors })
        // The company's changed since the card opened: what they are now, for it to show.
        if (error instanceof DeductionsChanged) {
            return ApiResponse.refused(409, "The company's payroll deductions changed while this was open.", "DEDUCTIONS_CHANGED", { current: error.current })
        }
        throw error
    }
})
