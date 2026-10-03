import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions/can"
import { FaceReviewService } from "@/lib/services/face-review.service"
import { punchCompany } from "@/lib/attendance/punch-access"
import { reviewer } from "@/lib/attendance/face-access"

/** Asks someone to verify their face again (ATTENDANCE_PLAN.md §9.5). Never oneself. */
const schema = z.object({ userId: z.string().min(1) })

export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const person = await prisma.user.findUnique({ where: { id: validation.data.userId }, select: { id: true, companyId: true, teamLeaderId: true } })
    if (!person?.companyId) return ApiResponse.notFound("Person not found")
    const access = await punchCompany(session, person.companyId)
    if ("denied" in access || access.companyId !== person.companyId) return ApiResponse.notFound("Person not found")
    if (!can(session.user, "attendance.approve_face", { companyId: person.companyId, userId: person.id, teamLeaderId: person.teamLeaderId })) return ApiResponse.forbidden()
    await FaceReviewService.requestReverify(person.companyId, person.id, reviewer(session))
    return ApiResponse.success({ requested: true })
})
