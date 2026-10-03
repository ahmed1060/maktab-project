import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { can, canCompanyWide } from "@/lib/permissions/can"
import { FaceVerificationService, FACE_CONSENT_VERSION } from "@/lib/services/face-verification.service"
import { punchCompany } from "@/lib/attendance/punch-access"

/**
 * Who face verification is asked of (ATTENDANCE_PLAN.md §9.5), for whoever
 * holds attendance.approve_face in the company: the people, whether it is
 * asked of them, and whether they consented. Never oneself.
 */
export const GET = withStandardHandler(async (req, session) => {
    const access = await punchCompany(session, new URL(req.url).searchParams.get("companyId"))
    if ("denied" in access) return access.denied
    if (!canCompanyWide(session.user, "attendance.approve_face") || !can(session.user, "attendance.approve_face", { companyId: access.companyId })) return ApiResponse.forbidden()
    const [status, overdue, people] = await Promise.all([
        FaceVerificationService.companyStatus(access.companyId),
        FaceVerificationService.overdueReverifications(access.companyId),
        prisma.user.findMany({
            where: { companyId: access.companyId, status: { notIn: ["DELETED", "ARCHIVED"] }, id: { not: session.user.id } },
            select: {
                id: true, firstName: true, lastName: true, faceVerificationRequired: true,
                biometricConsents: { where: { textVersion: FACE_CONSENT_VERSION, withdrawnAt: null }, select: { acceptedAt: true }, take: 1 },
            },
            orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        }),
    ])
    return ApiResponse.success({
        company: status,
        // Re-verifications left undone too long (§9.5); never one's own.
        overdue: overdue.filter(o => o.userId !== session.user.id),
        people: people.map(p => ({
            id: p.id, name: `${p.firstName} ${p.lastName}`.trim(), required: p.faceVerificationRequired,
            consentedAt: p.biometricConsents[0]?.acceptedAt ?? null,
        })),
    })
})

const schema = z.object({ userId: z.string().min(1), required: z.boolean() })

export const PUT = withStandardHandler(async (_req, session, json) => {
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const person = await prisma.user.findUnique({ where: { id: validation.data.userId }, select: { id: true, companyId: true, teamLeaderId: true } })
    if (!person?.companyId) return ApiResponse.notFound("Person not found")
    const access = await punchCompany(session, person.companyId)
    if ("denied" in access || access.companyId !== person.companyId) return ApiResponse.notFound("Person not found")
    if (!can(session.user, "attendance.approve_face", { companyId: person.companyId, userId: person.id, teamLeaderId: person.teamLeaderId })) return ApiResponse.forbidden()
    await FaceVerificationService.setRequired(person.companyId, person.id, validation.data.required, session.user.id, session.user.role === "SUPER_ADMIN")
    return ApiResponse.success({ userId: person.id, required: validation.data.required })
})
