import { prisma } from "@/lib/prisma"
import { toDateString } from "@/lib/attendance/calendar"
import { AuditLogService } from "./audit-log.service"

/**
 * Attendance that changed after its month's payroll was approved
 * (ATTENDANCE_PLAN.md §12.3). The paid days are never rewritten; each
 * difference is listed here, beside the payroll it concerns, for whoever
 * prepares payroll to settle with an adjustment in the current period and
 * then mark resolved, saying how.
 */

function fail(code: string): never {
    throw new Error(code)
}

export class AttendanceDiscrepancyService {
    /** Open differences, and those resolved in the last ninety days. */
    static async list(companyId: string) {
        const since = new Date(Date.now() - 90 * 86_400_000)
        const rows = await prisma.attendanceDiscrepancy.findMany({
            where: { companyId, OR: [{ resolvedAt: null }, { resolvedAt: { gte: since } }] },
            orderBy: [{ resolvedAt: { sort: "desc", nulls: "first" } }, { date: "desc" }],
            take: 500,
            include: { user: { select: { firstName: true, lastName: true } } },
        })
        return rows.map(({ user, date, ...d }) => ({
            ...d,
            date: toDateString(date),
            name: `${user.firstName} ${user.lastName}`.trim(),
            // What the person would be owed (positive) or would owe (negative) now.
            differenceMinor: (d.paidDeductionMinor - d.nowDeductionMinor) + (d.nowOvertimeMinor - d.paidOvertimeMinor),
        }))
    }

    static async of(id: string) {
        return prisma.attendanceDiscrepancy.findUnique({ where: { id }, select: { id: true, companyId: true, resolvedAt: true } })
    }

    /** Settled — by an adjustment, or a decision that none is due — and how. */
    static async resolve(id: string, resolution: string, actorId: string, superAdmin: boolean) {
        if (!resolution.trim()) fail("REASON_REQUIRED")
        await prisma.$transaction(async tx => {
            const d = await tx.attendanceDiscrepancy.findUnique({ where: { id } }) ?? fail("DISCREPANCY_NOT_FOUND")
            if (d.resolvedAt) fail("DISCREPANCY_ALREADY_RESOLVED")
            await tx.attendanceDiscrepancy.update({ where: { id }, data: { resolvedAt: new Date(), resolvedById: actorId, resolution: resolution.trim() } })
            await AuditLogService.log("RESOLVE_ATTENDANCE_DISCREPANCY", "ATTENDANCE_DISCREPANCY", id, {
                tx, ...(superAdmin ? { superAdminId: actorId } : { userId: actorId }),
                details: { companyId: d.companyId, userId: d.userId, date: toDateString(d.date), reason: resolution.trim() },
            })
        })
    }
}
