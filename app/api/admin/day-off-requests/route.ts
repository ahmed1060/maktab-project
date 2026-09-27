export const dynamic = 'force-dynamic'

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions/can"
import { scopesToTeam, teamMemberWhere } from "@/lib/team-scope"

export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const companyId = searchParams.get('companyId')
    const userRole = session.user.role

    if (!can(session.user, "dayoff.view")) {
        return ApiResponse.forbidden("Unauthorized")
    }

    const where: any = {}
    if (userRole === 'SUPER_ADMIN') {
        if (companyId) {
            where.user = { companyId }
        }
    } else if (scopesToTeam(session.user, "dayoff.view")) {
        // Held for a team, it shows the team's requests (and their own), not
        // the company's: dates, reasons and balances are the team's business.
        where.user = { companyId: session.user.companyId, ...teamMemberWhere(session.user.id) }
    } else {
        where.user = { companyId: session.user.companyId }
    }

    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    try {
        const [requests, total] = await Promise.all([
            prisma.dayOffRequest.findMany({
                where,
                include: {
                    user: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                            role: true,
                            dayOffCredit: true,
                            // Who leads them: the screen offers Approve to a
                            // team-scoped approver for their own team only.
                            teamLeaderId: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.dayOffRequest.count({ where })
        ])

        return ApiResponse.success({
            data: requests,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        })
    } catch (error: any) {
        throw error
    }
})
