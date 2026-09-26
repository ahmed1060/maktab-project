export const dynamic = 'force-dynamic'

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { downloadTemplateBuffer } from "@/lib/storage"
import { generateBulkTaskTemplate } from "@/lib/services/template-generator.service"
import type { Locale } from "@/lib/translations"
import { NextResponse } from "next/server"
import { scopesToTeam, teamMemberWhere, and } from "@/lib/team-scope"

export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const locale = (searchParams.get('locale') || 'en') as Locale

    const baseBuffer = await downloadTemplateBuffer(locale)
    if (!baseBuffer) {
        return ApiResponse.notFound("Template file not found")
    }

    const userRole = session.user.role
    const userCompanyId = (session.user as any).companyId

    // Same scope this endpoint's callers already see elsewhere: own company
    // for Admin/Team Leader, ?companyId= for Super Admin (required — a
    // template with no company's users/vendors in it isn't useful).
    let targetCompanyId: string | null = null
    if (userRole === 'SUPER_ADMIN') {
        targetCompanyId = searchParams.get('companyId')
        if (!targetCompanyId) return ApiResponse.badRequest("companyId is required")
    } else {
        if (!userCompanyId) return ApiResponse.forbidden("User is not assigned to a company")
        targetCompanyId = userCompanyId
    }

    const userWhere: any = { companyId: targetCompanyId, status: { not: 'DELETED' } }
    // Same restriction the assignee picker and /api/users already enforce —
    // a Team Leader can't assign an Admin, so listing one in their template
    // dropdown would just set them up to pick someone task creation then
    // rejects.
    if (scopesToTeam(session.user, "tasks.create")) {
        userWhere.role = { notIn: ['ADMIN', 'SUPER_ADMIN'] }
        // And their own team within that. An export is a read like any other,
        // and a spreadsheet of every colleague is the easiest of all of these
        // to walk out of the building with.
        and(userWhere, teamMemberWhere(session.user.id))
    }

    const [users, vendors] = await Promise.all([
        prisma.user.findMany({
            where: userWhere,
            select: { firstName: true, lastName: true, username: true, role: true },
            orderBy: { firstName: 'asc' }
        }),
        prisma.vendor.findMany({
            where: { companyId: targetCompanyId! },
            select: { name: true, locationName: true },
            orderBy: { name: 'asc' }
        })
    ])

    try {
        const fileBuffer = await generateBulkTaskTemplate(baseBuffer, locale, users, vendors)
        return new NextResponse(fileBuffer as any, {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="task_template_${locale}.xlsx"`
            }
        })
    } catch (error: any) {
        if (error.message === 'TEMPLATE_BASE_EMPTY') return ApiResponse.error("Template file is invalid — please re-upload it")
        throw error
    }
})
