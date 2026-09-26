import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { checkTeamAssignment } from "@/lib/team-assignment"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { notifyTeamMoves } from "@/lib/services/team-notify.service"

/**
 * Assign several employees to a team leader at once.
 *
 * Exists because setting a leader for twenty people one form at a time is the
 * friction that leaves teams half-populated — and a half-populated team is
 * exactly the state that makes hard scoping look like a bug, since the people
 * nobody assigned are visible to no leader at all.
 *
 * The rules are the same ones the single-employee path uses, deliberately: the
 * shortcut must not be the loose door. Only an Admin may call it, every target
 * must be an EMPLOYEE in the caller's company, and the destination must be a
 * TEAM_LEADER in that same company — or null, to unassign.
 */

const bulkTeamSchema = z.object({
    userIds: z.array(z.string().min(1)).min(1).max(200),
    teamLeaderId: z.string().min(1).nullable(),
})

export const PATCH = withStandardHandler(async (req, session, json) => {
    const validation = bulkTeamSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    const { userIds, teamLeaderId } = validation.data
    const userRole = session.user.role
    const companyId = session.user.companyId

    if (userRole !== 'SUPER_ADMIN' && !companyId) {
        return ApiResponse.forbidden("User is not assigned to a company")
    }

    // Deduped: a repeated id would otherwise make the count check below
    // compare a padded list against a set of rows.
    const ids = [...new Set(userIds)]

    const targets = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, role: true, companyId: true, status: true, teamLeaderId: true },
    })
    if (targets.length !== ids.length) return ApiResponse.badRequest("One of those people no longer exists")

    if (userRole !== 'SUPER_ADMIN' && targets.some(t => t.companyId !== companyId)) {
        return ApiResponse.forbidden("Those people are not all in your company")
    }

    let leader: { id: string; role: string; companyId: string | null; status: string } | null = null
    if (teamLeaderId) {
        leader = await prisma.user.findUnique({
            where: { id: teamLeaderId },
            select: { id: true, role: true, companyId: true, status: true },
        })
        if (!leader) return ApiResponse.badRequest("That team leader no longer exists")
    }

    // Every target checked individually against the same rule the single path
    // uses, rather than one representative check. A batch is exactly where a
    // representative check goes wrong: the first row is an employee and the
    // fourteenth is a team leader.
    for (const target of targets) {
        const verdict = checkTeamAssignment(target, leader)
        if (!verdict.ok) return ApiResponse.badRequest(verdict.refusal.message)
    }

    const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.user.updateMany({
            where: { id: { in: ids } },
            data: { teamLeaderId },
        })
        await AuditLogService.log('REASSIGN_TEAM', 'USER', teamLeaderId ?? 'unassigned', {
            tx,
            userId: userRole !== 'SUPER_ADMIN' ? session.user.id : null,
            superAdminId: userRole === 'SUPER_ADMIN' ? session.user.id : null,
            details: { to: teamLeaderId, affected: ids, bulk: true },
        })
        return result.count
    })

    // After the commit, and one notification per person however many moved —
    // see planTeamNotifications for why a leader hears once, not forty times.
    await notifyTeamMoves(targets.map(t => ({ userId: t.id, from: t.teamLeaderId, to: teamLeaderId })))

    return ApiResponse.success({ updated })
}, {
    // Admins only, matching who may set a leader on the single-employee form.
    allowedRoles: ['ADMIN', 'SUPER_ADMIN'],
})
