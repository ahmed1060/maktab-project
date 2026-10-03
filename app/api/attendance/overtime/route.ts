import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { AttendanceRequestService } from "@/lib/services/attendance-request.service"
import { punchCompany, decidesFor, decidesPerson } from "@/lib/attendance/punch-access"
import { isDateString, addDays } from "@/lib/attendance/calendar"
import { overtimeDecisionSchema } from "@/lib/validations/attendance-request.schema"

/** Overtime waiting for a decision, and the decisions made, for the people this person decides for. */
export const GET = withStandardHandler(async (req, session) => {
    const url = new URL(req.url)
    const access = await punchCompany(session, url.searchParams.get("companyId"))
    if ("denied" in access) return access.denied
    const visible = decidesFor(session, "attendance.approve_overtime")
    if (!visible) return ApiResponse.forbidden()
    const from = url.searchParams.get("from") ?? ""
    const to = url.searchParams.get("to") ?? ""
    if (!isDateString(from) || !isDateString(to) || to < from) return ApiResponse.badRequest("from and to must be dates, from first")
    if (to > addDays(from, 92)) return ApiResponse.badRequest("Ask for at most three months at a time")
    return ApiResponse.success(await AttendanceRequestService.overtime(access.companyId, { from, to }, visible))
})

/** Approves or rejects somebody's overtime on a date, after it or ahead of it. */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = overtimeDecisionSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const access = await punchCompany(session, validation.data.companyId)
    if ("denied" in access) return access.denied
    const person = await prisma.user.findFirst({ where: { id: validation.data.userId, companyId: access.companyId }, select: { id: true, teamLeaderId: true } })
    if (!person) return ApiResponse.notFound("That person wasn't found in this company.")
    if (!decidesPerson(session, "attendance.approve_overtime", { companyId: access.companyId, userId: person.id, teamLeaderId: person.teamLeaderId })) return ApiResponse.forbidden()
    const { userId, date, status, minutes, note } = validation.data
    const saved = await AttendanceRequestService.decideOvertime(access.companyId, { userId, date, status, minutes, note }, session.user.id)
    return ApiResponse.success(saved)
})
