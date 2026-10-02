import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { AuditLogService } from "./audit-log.service"
import { NotificationService } from "./notification.service"
import { recomputeAfter } from "./attendance-recompute"
import { lockMonths, lockedMonths, punchMonths } from "./attendance-lock"
import type { Visibility } from "./attendance-punch.service"
import { addDays } from "@/lib/attendance/calendar"
import { optional } from "@/lib/notice"

/**
 * Check-ins flagged for a person to decide (ATTENDANCE_PLAN.md §9.6, §13.1):
 * something did not check out, but it could be innocent. Accepted, it counts
 * as a normal check-in; rejected, it does not, and the day is as if there
 * were none. Either way its owner is told.
 *
 * Who decides depends on why it was flagged. The app not being verified
 * (attestation in testing) is the Super Admin's to look at, as decided for
 * testing; the company can't judge the integrity of our app. Anything else —
 * outside the place, a vague fix, off the office's network — is the company's
 * own reviewers', those who may correct the person's attendance. The Super
 * Admin may decide any.
 */

export type Reviewer = "COMPANY" | "PLATFORM"

/** Flagged only because our app could not prove itself, or for that too: the Super Admin's. */
export const PLATFORM_REASON = "ATTESTATION_UNVERIFIED"

function fail(code: string): never {
    throw new Error(code)
}

async function actorOf(tx: Prisma.TransactionClient, actorId: string) {
    const superAdmin = await tx.superAdmin.findUnique({ where: { id: actorId }, select: { id: true } })
    return superAdmin ? { superAdminId: actorId } : { userId: actorId }
}

const wallClockText = (d: Date) => d.toISOString().slice(0, 19)

const reviewerWhere = (reviewer: Reviewer): Prisma.AttendancePunchWhereInput =>
    reviewer === "PLATFORM" ? { flagReasons: { has: PLATFORM_REASON } } : { NOT: { flagReasons: { has: PLATFORM_REASON } } }

function visibleWhere(v: Visibility): Prisma.AttendancePunchWhereInput {
    if (v.kind === "COMPANY") return {}
    if (v.kind === "TEAM") return { user: { teamLeaderId: v.leaderId } }
    return { userId: v.userId }
}

const SHOWN = {
    id: true, companyId: true, userId: true, punchAtLocal: true, direction: true, flagReasons: true, checkIn: true, receivedAt: true,
    user: { select: { firstName: true, lastName: true, teamLeaderId: true } },
    workLocation: { select: { name: true, latitude: true, longitude: true, radiusMeters: true } },
    phone: { select: { model: true, platform: true } },
    company: { select: { name: true } },
} as const

const shown = (p: Prisma.AttendancePunchGetPayload<{ select: typeof SHOWN }>) => {
    const { user, punchAtLocal, company, ...rest } = p
    return { ...rest, at: wallClockText(punchAtLocal), name: `${user!.firstName} ${user!.lastName}`.trim(), teamLeaderId: user!.teamLeaderId, companyName: company.name }
}

export class AttendanceFlagService {
    /** What waits for this reviewer: one company's, or — for the Super Admin's queue — every company's. */
    static async list(reviewer: Reviewer, scope: { companyId: string; visible: Visibility } | "ALL") {
        const rows = await prisma.attendancePunch.findMany({
            where: {
                status: "FLAGGED", voidedAt: null, ...reviewerWhere(reviewer),
                ...(scope === "ALL" ? {} : { companyId: scope.companyId, ...visibleWhere(scope.visible) }),
            },
            select: SHOWN,
            orderBy: { punchAtLocal: "asc" },
            take: 500,
        })
        return rows.map(shown)
    }

    static async flaggedOf(id: string) {
        return prisma.attendancePunch.findUnique({
            where: { id },
            select: { id: true, companyId: true, userId: true, status: true, flagReasons: true, user: { select: { teamLeaderId: true } } },
        })
    }

    /** Which reviewer a flagged check-in waits for. */
    static reviewerOf(flagReasons: readonly string[]): Reviewer {
        return flagReasons.includes(PLATFORM_REASON) ? "PLATFORM" : "COMPANY"
    }

    /**
     * Accepted: it counts, and the days are worked out again. Rejected: it
     * doesn't. Never in a month whose payroll is approved (§12.1), and never
     * one's own (the route asks can()).
     */
    static async decide(id: string, decision: { accept: boolean; reason?: string | null }, deciderId: string) {
        const reason = decision.accept ? null : decision.reason?.trim().slice(0, 500) || null
        const out = await prisma.$transaction(async tx => {
            const punch = await tx.attendancePunch.findUnique({ where: { id }, select: { companyId: true, userId: true, punchAtLocal: true, status: true, flagReasons: true } }) ?? fail("CHECK_IN_NOT_FOUND")
            if (punch.userId === deciderId) fail("CANNOT_DECIDE_OWN")
            const local = wallClockText(punch.punchAtLocal)
            const months = await punchMonths(tx, punch.companyId, punch.userId!, local)
            await lockMonths(tx, punch.companyId, months)
            if ((await lockedMonths(tx, punch.companyId, months)).size > 0) fail("PAYROLL_MONTH_LOCKED")
            // Read again under the lock: another reviewer may have decided it first.
            const { count } = await tx.attendancePunch.updateMany({ where: { id, status: "FLAGGED" }, data: { status: decision.accept ? "ACCEPTED" : "REJECTED" } })
            if (count === 0) fail("CHECK_IN_NOT_FLAGGED")
            await AuditLogService.log(decision.accept ? "ACCEPT_FLAGGED_CHECK_IN" : "REJECT_FLAGGED_CHECK_IN", "ATTENDANCE_PUNCH", id, {
                tx, ...(await actorOf(tx, deciderId)),
                details: { companyId: punch.companyId, userId: punch.userId, at: local, flagReasons: punch.flagReasons, reason },
            })
            await NotificationService.notify(punch.userId!, "ATTENDANCE_CHECK_IN", {
                key: decision.accept ? "notice_att_checkin_accepted" : "notice_att_checkin_rejected",
                params: { date: { date: local.slice(0, 10) }, time: local.slice(11, 16), reason: optional("notice_reason_suffix", { reason: reason ?? "" }, reason) },
            }, "/dashboard/attendance?tab=punches", tx)
            return { companyId: punch.companyId, userId: punch.userId!, date: local.slice(0, 10) }
        })
        // From the day before: a check-in after midnight can end the night shift that began then.
        if (decision.accept) await recomputeAfter(out.companyId, addDays(out.date, -1), [out.userId])
    }

    /**
     * Across every company, over the last days: check-ins refused and why,
     * flagged and why, and how many — the Super Admin's integrity view
     * (§13.7). A company with a sudden run of refusals is under attack or has
     * a broken app release; either way, someone should look.
     */
    static async integrity(days = 30, now = new Date()) {
        const since = new Date(now.getTime() - days * 86_400_000)
        const [refusals, checkIns, companies] = await Promise.all([
            prisma.checkInRefusal.groupBy({ by: ["companyId", "reason"], where: { at: { gte: since } }, _count: { _all: true } }),
            prisma.attendancePunch.findMany({ where: { source: "MOBILE", receivedAt: { gte: since } }, select: { companyId: true, status: true, flagReasons: true } }),
            prisma.company.findMany({ select: { id: true, name: true } }),
        ])
        const names = new Map(companies.map(c => [c.id, c.name]))
        type Row = { companyId: string; name: string; checkIns: number; accepted: number; flagged: number; refused: number; refusedBy: Record<string, number>; flaggedBy: Record<string, number> }
        const rows = new Map<string, Row>()
        const row = (companyId: string) => {
            if (!rows.has(companyId)) rows.set(companyId, { companyId, name: names.get(companyId) ?? "?", checkIns: 0, accepted: 0, flagged: 0, refused: 0, refusedBy: {}, flaggedBy: {} })
            return rows.get(companyId)!
        }
        for (const c of checkIns) {
            const r = row(c.companyId)
            r.checkIns++
            if (c.status === "ACCEPTED") r.accepted++
            if (c.flagReasons.length > 0) {
                r.flagged++
                for (const f of c.flagReasons) r.flaggedBy[f] = (r.flaggedBy[f] ?? 0) + 1
            }
        }
        for (const g of refusals) {
            const r = row(g.companyId)
            r.refused += g._count._all
            r.refusedBy[g.reason] = g._count._all
        }
        // Worst first: the most refused, in proportion to what came in.
        return [...rows.values()].sort((a, b) => b.refused / Math.max(1, b.refused + b.checkIns) - a.refused / Math.max(1, a.refused + a.checkIns) || b.refused - a.refused || a.name.localeCompare(b.name))
    }
}
