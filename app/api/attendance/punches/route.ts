import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { AttendancePunchService } from "@/lib/services/attendance-punch.service"
import { punchCompany, visibilityFor, correctsCompany, correctsPerson } from "@/lib/attendance/punch-access"
import { isDateString, addDays } from "@/lib/attendance/calendar"
import { manualPunchSchema } from "@/lib/validations/attendance-punch.schema"

/**
 * Punches between two dates: one's own always, other people's with
 * attendance.view_team at its scope, and those still waiting for a person
 * (`unmatched=1`) to whoever corrects the whole company.
 */
export const GET = withStandardHandler(async (req, session) => {
    const url = new URL(req.url)
    const access = await punchCompany(session, url.searchParams.get("companyId"))
    if ("denied" in access) return access.denied
    const from = url.searchParams.get("from") ?? ""
    const to = url.searchParams.get("to") ?? ""
    if (!isDateString(from) || !isDateString(to) || to < from) return ApiResponse.badRequest("from and to must be dates, from first")
    if (to > addDays(from, 62)) return ApiResponse.badRequest("Ask for at most two months at a time")
    const unmatched = url.searchParams.get("unmatched") === "1"
    if (unmatched && !correctsCompany(session, access.companyId)) return ApiResponse.forbidden()
    const punches = await AttendancePunchService.list(
        access.companyId,
        { from, to, userId: url.searchParams.get("userId"), unmatched },
        visibilityFor(session),
    )
    return ApiResponse.success({ punches })
})

/** A punch added by hand, for somebody else, with a reason (§14). */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = manualPunchSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const access = await punchCompany(session, validation.data.companyId)
    if ("denied" in access) return access.denied
    const person = await prisma.user.findFirst({ where: { id: validation.data.userId, companyId: access.companyId }, select: { id: true, teamLeaderId: true } })
    if (!person) return ApiResponse.notFound("That person wasn't found in this company.")
    if (!correctsPerson(session, { companyId: access.companyId, userId: person.id, teamLeaderId: person.teamLeaderId })) return ApiResponse.forbidden()
    const { userId, at, direction, note } = validation.data
    const created = await AttendancePunchService.addManual(access.companyId, { userId, at, direction, note }, session.user.id)
    return ApiResponse.success(created, 201)
})
