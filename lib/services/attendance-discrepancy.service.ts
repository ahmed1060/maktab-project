import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { isDateString, toDateString } from "@/lib/attendance/calendar"
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

/** Open differences per page, and the recently resolved shown beside the first. */
export const DISCREPANCY_PAGE = 200
const RESOLVED_SHOWN = 100

/** "2026-09-08_<id>": the last row of the page before. Refused if malformed. */
function parseCursor(cursor: string) {
    const m = /^(\d{4}-\d{2}-\d{2})_(.+)$/.exec(cursor)
    if (!m || !isDateString(m[1])) fail("INVALID_CURSOR")
    return { date: new Date(`${m[1]}T00:00:00Z`), id: m[2] }
}

type Row = Prisma.AttendanceDiscrepancyGetPayload<{ include: { user: { select: { firstName: true; lastName: true } } } }>
const shape = ({ user, date, ...d }: Row) => ({
    ...d,
    date: toDateString(date),
    name: `${user.firstName} ${user.lastName}`.trim(),
    // What the person would be owed (positive) or would owe (negative) now.
    differenceMinor: (d.paidDeductionMinor - d.nowDeductionMinor) + (d.nowOvertimeMinor - d.paidOvertimeMinor),
})

export class AttendanceDiscrepancyService {
    /**
     * The open differences, a page at a time, oldest-paid last — every one is
     * money somebody is owed, so none is cut off: the next page follows from
     * `nextCursor` (review on #16). With the first page, those resolved in the
     * last ninety days.
     */
    static async list(companyId: string, page: { after?: string | null; limit?: number } = {}) {
        const limit = page.limit ?? DISCREPANCY_PAGE
        const after = page.after ? parseCursor(page.after) : null
        const include = { user: { select: { firstName: true, lastName: true } } } as const
        const [openRows, openCount, resolvedRows] = await Promise.all([
            prisma.attendanceDiscrepancy.findMany({
                where: {
                    companyId, resolvedAt: null,
                    ...(after && { OR: [{ date: { lt: after.date } }, { date: after.date, id: { lt: after.id } }] }),
                },
                orderBy: [{ date: "desc" }, { id: "desc" }],
                take: limit + 1,
                include,
            }),
            prisma.attendanceDiscrepancy.count({ where: { companyId, resolvedAt: null } }),
            after ? [] : prisma.attendanceDiscrepancy.findMany({
                where: { companyId, resolvedAt: { gte: new Date(Date.now() - 90 * 86_400_000) } },
                orderBy: [{ resolvedAt: "desc" }, { id: "desc" }],
                take: RESOLVED_SHOWN,
                include,
            }),
        ])
        const shown = openRows.slice(0, limit)
        const last = shown[shown.length - 1]
        return {
            open: shown.map(shape),
            openCount,
            nextCursor: openRows.length > limit && last ? `${toDateString(last.date)}_${last.id}` : null,
            resolved: resolvedRows.map(shape),
        }
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
