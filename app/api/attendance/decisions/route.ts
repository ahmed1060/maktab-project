import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { AttendanceExceptionService } from "@/lib/services/attendance-exception.service"
import { punchCompany, correctsPerson } from "@/lib/attendance/punch-access"
import { dayDecisionSchema } from "@/lib/validations/attendance-request.schema"

/** Excuses or accepts part of somebody's day: attendance.correct at its scope, never one's own. */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = dayDecisionSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const access = await punchCompany(session, validation.data.companyId)
    if ("denied" in access) return access.denied
    const person = await prisma.user.findFirst({ where: { id: validation.data.userId, companyId: access.companyId }, select: { id: true, teamLeaderId: true } })
    if (!person) return ApiResponse.notFound("That person wasn't found in this company.")
    if (!correctsPerson(session, { companyId: access.companyId, userId: person.id, teamLeaderId: person.teamLeaderId })) return ApiResponse.forbidden()
    const { userId, date, subject, outcome, reason } = validation.data
    return ApiResponse.success(await AttendanceExceptionService.decide(access.companyId, { userId, date, subject, outcome, reason }, session.user.id), 201)
})
