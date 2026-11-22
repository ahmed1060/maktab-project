import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { AttendancePunchService } from "@/lib/services/attendance-punch.service"
import { punchCompany, correctsCompany, correctsPerson } from "@/lib/attendance/punch-access"
import { mapCodeSchema } from "@/lib/validations/attendance-punch.schema"

/** Employee numbers: those mapped to a person, and those seen in punches with nobody yet. */
export const GET = withStandardHandler(async (req, session) => {
    const access = await punchCompany(session, new URL(req.url).searchParams.get("companyId"))
    if ("denied" in access) return access.denied
    if (!correctsCompany(session, access.companyId)) return ApiResponse.forbidden()
    return ApiResponse.success(await AttendancePunchService.codes(access.companyId))
})

/** Says who an employee number is; their waiting punches in open months become theirs. */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = mapCodeSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const access = await punchCompany(session, validation.data.companyId)
    if ("denied" in access) return access.denied
    if (!correctsCompany(session, access.companyId)) return ApiResponse.forbidden()
    const person = await prisma.user.findFirst({ where: { id: validation.data.userId, companyId: access.companyId }, select: { id: true, teamLeaderId: true } })
    if (!person) return ApiResponse.notFound("That person wasn't found in this company.")
    // One's own number is the one thing whoever maps numbers may do for themselves:
    // the HR officer who maps them scans in too (ATTENDANCE_PLAN.md §14, PR 366).
    // Anybody else's is checked at the correcting's scope.
    const own = person.id === session.user.id
    if (!own && !correctsPerson(session, { companyId: access.companyId, userId: person.id, teamLeaderId: person.teamLeaderId })) return ApiResponse.forbidden()
    const result = await AttendancePunchService.mapCode(access.companyId, { code: validation.data.code, userId: person.id }, session.user.id)
    return ApiResponse.success(result, 201)
})
