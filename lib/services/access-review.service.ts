import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions/can"
import { holdersOf } from "@/lib/permissions/holders"
import type { Permission } from "@/lib/permissions/catalogue"
import type { Prisma, UserRole } from "@prisma/client"

/**
 * Periodic access review (ROLES_PLAN.md §6.14). Access that was right a year
 * ago often is not now.
 *
 * Off unless the Super Admin switches it on for a company, as part of its
 * contract — the company cannot, since a review the reviewed can switch off is
 * not much of a review. When on, every few months a review opens: who holds
 * each sensitive permission, a line each, for the company's Admins to confirm
 * or ask to change. Nobody answers their own line; the Super Admin can answer
 * any. Asking to change one becomes a role change request to the Super Admin
 * (§6.9), the channel roles already change through. Reviews are kept.
 */

/** The permissions reviewed: salaries, payroll approval, role assignment. */
export const REVIEWED: readonly Permission[] = ["salary.view", "salary.edit", "payroll.approve", "employees.assign_role"]

const AT_WORK = ["ACTIVE", "OFFLINE"] as const

type Session = { user: { id: string; role: string; companyId?: string | null; grants?: string | null } }

const SHAPE = {
    id: true, companyId: true, status: true, createdAt: true, completedAt: true,
    company: { select: { name: true } },
    lines: {
        select: {
            id: true, userId: true, userName: true, permission: true, scope: true, roleName: true, decision: true, note: true, answeredAt: true,
            answeredBy: { select: { firstName: true, lastName: true } },
            answeredBySuperAdmin: { select: { firstName: true, lastName: true } },
        },
        orderBy: [{ permission: "asc" }, { roleName: "asc" }],
    },
} satisfies Prisma.AccessReviewSelect

/**
 * Which lines name a built-in role, so screens can show it in the reader's
 * language. A line keeps the role's name as it was; a built-in role's name
 * never changes and no other role in its company can take it, so the name
 * says which one it was.
 */
type WithBuiltIn<R extends { lines: unknown[] }> = Omit<R, "lines"> & { lines: (R["lines"][number] & { roleBuiltIn: UserRole | null })[] }

async function withBuiltIn<R extends { companyId: string; lines: { roleName: string }[] }>(reviews: R[]): Promise<WithBuiltIn<R>[]> {
    const builtIns = await prisma.role.findMany({
        where: { companyId: { in: [...new Set(reviews.map(r => r.companyId))] }, builtIn: { not: null } },
        select: { companyId: true, name: true, builtIn: true },
    })
    const kind = new Map(builtIns.map(r => [`${r.companyId}/${r.name}`, r.builtIn]))
    return reviews.map(r => ({ ...r, lines: r.lines.map(l => ({ ...l, roleBuiltIn: kind.get(`${r.companyId}/${l.roleName}`) ?? null })) }))
}

function addMonths(at: Date, months: number): Date {
    const next = new Date(at)
    next.setUTCMonth(next.getUTCMonth() + months)
    return next
}

export class AccessReviewService {
    /** The Super Admin's switch and interval for a company. */
    static async configure(companyId: string, input: { enabled: boolean; months: number }, session: Session) {
        if (session.user.role !== "SUPER_ADMIN") throw new Error("FORBIDDEN")
        const before = await prisma.company.findUnique({
            where: { id: companyId },
            select: { accessReviewEnabled: true, accessReviewMonths: true, accessReviewNextAt: true },
        })
        if (!before) throw new Error("COMPANY_NOT_FOUND")
        // Switched on: the first review opens with the next daily run. Off:
        // nothing further is scheduled; the reviews already held stay.
        const nextAt = !input.enabled ? null
            : before.accessReviewEnabled && before.accessReviewNextAt ? before.accessReviewNextAt
            : new Date()
        const updated = await prisma.company.update({
            where: { id: companyId },
            data: { accessReviewEnabled: input.enabled, accessReviewMonths: input.months, accessReviewNextAt: nextAt },
            select: { accessReviewEnabled: true, accessReviewMonths: true, accessReviewNextAt: true },
        })
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log("CONFIGURE_ACCESS_REVIEW", "COMPANY", companyId, {
            superAdminId: session.user.id,
            details: { before: { enabled: before.accessReviewEnabled, months: before.accessReviewMonths }, after: input },
        })
        return updated
    }

    /** Open a review for a company now: who holds each reviewed permission. */
    static async open(companyId: string) {
        const people = await prisma.user.findMany({
            where: { companyId, status: { in: [...AT_WORK] }, OR: REVIEWED.map(p => holdersOf(p)) },
            select: {
                id: true, firstName: true, lastName: true,
                assignedRole: { select: { id: true, name: true, grants: { where: { permission: { in: [...REVIEWED] } }, select: { permission: true, scope: true } } } },
            },
        })
        // What was reviewed, kept on the line: it is evidence, and outlives
        // the person's account and the role.
        const lines = people.flatMap(p => (p.assignedRole?.grants ?? []).map(g => ({
            userId: p.id, userName: `${p.firstName} ${p.lastName}`.trim(),
            permission: g.permission, scope: g.scope, roleName: p.assignedRole!.name, roleId: p.assignedRole!.id,
        })))
        const review = await prisma.accessReview.create({
            data: {
                companyId,
                // Nothing to review is a review done.
                ...(lines.length === 0 ? { status: "COMPLETED" as const, completedAt: new Date() } : {}),
                lines: { create: lines },
            },
            select: { id: true, status: true },
        })
        if (lines.length > 0) {
            const deciders = await prisma.user.findMany({
                where: { companyId, status: { in: [...AT_WORK] }, ...holdersOf("employees.assign_role") },
                select: { id: true },
            })
            const { NotificationService } = await import("./notification.service")
            await NotificationService.notifyMany(
                deciders.map(d => d.id),
                "ROLE_ACCESS_REVIEW",
                { key: "notice_access_review_ready", params: { count: lines.length } },
                `/dashboard/role-requests?tab=reviews&highlight=${review.id}`,
            )
        }
        return review
    }

    /**
     * The daily job: opens a review for every company whose one is due, and
     * schedules the next. A company switched off has nothing scheduled.
     */
    static async runDue(now: Date = new Date()) {
        const due = await prisma.company.findMany({
            where: { accessReviewEnabled: true, accessReviewNextAt: { lte: now } },
            select: { id: true, accessReviewMonths: true },
        })
        for (const company of due) {
            await AccessReviewService.open(company.id)
            await prisma.company.update({ where: { id: company.id }, data: { accessReviewNextAt: addMonths(now, company.accessReviewMonths) } })
        }
        return { opened: due.length }
    }

    /** A company's reviews for its Admins; every company's for the Super Admin. */
    static async list(session: Session, filter: { status?: string | null; companyId?: string | null }) {
        const where: Prisma.AccessReviewWhereInput = {}
        if (filter.status) where.status = filter.status as any
        if (session.user.role === "SUPER_ADMIN") {
            if (filter.companyId) where.companyId = filter.companyId
        } else {
            if (!session.user.companyId || !can(session.user, "employees.assign_role")) throw new Error("FORBIDDEN")
            where.companyId = session.user.companyId
        }
        return withBuiltIn(await prisma.accessReview.findMany({ where, select: SHAPE, orderBy: { createdAt: "desc" }, take: 50 }))
    }

    /**
     * Confirm a line, or ask for it to change (a reason required, and passed
     * on to the Super Admin as a role change request). Once per line; the
     * review is done when every line is answered.
     */
    static async answer(lineId: string, input: { decision: "CONFIRMED" | "CHANGE_REQUESTED"; note?: string | null }, session: Session) {
        const actor = session.user
        const line = await prisma.accessReviewLine.findUnique({
            where: { id: lineId },
            select: {
                id: true, reviewId: true, userId: true, userName: true, permission: true, roleName: true, roleId: true, decision: true,
                review: { select: { companyId: true, status: true } },
            },
        })
        if (!line) throw new Error("LINE_NOT_FOUND")
        const superAdmin = actor.role === "SUPER_ADMIN"
        if (!superAdmin && (actor.companyId !== line.review.companyId || !can(actor, "employees.assign_role"))) throw new Error("FORBIDDEN")
        // Nobody vouches for their own access.
        if (!superAdmin && line.userId === actor.id) throw new Error("OWN_LINE")
        if (input.decision === "CHANGE_REQUESTED" && !input.note?.trim()) throw new Error("REASON_REQUIRED")

        const done = await prisma.accessReviewLine.updateMany({
            where: { id: lineId, decision: null },
            data: {
                decision: input.decision, note: input.note?.trim() || null, answeredAt: new Date(),
                ...(superAdmin ? { answeredBySuperAdminId: actor.id } : { answeredById: actor.id }),
            },
        })
        if (done.count === 0) throw new Error("ALREADY_ANSWERED")

        if (input.decision === "CHANGE_REQUESTED" && !superAdmin) {
            const { RoleChangeRequestService } = await import("./role-change-request.service")
            try {
                await RoleChangeRequestService.create({
                    // The role that was reviewed, not whatever the person holds
                    // now; gone since, it is a request about the company's roles.
                    roleId: line.roleId,
                    description: `Access review: ${line.userName} holds ${line.permission} through ${line.roleName}. ${input.note!.trim()}`,
                }, session)
            } catch (error) {
                // No request filed, so not answered: it waits again.
                await prisma.accessReviewLine.update({
                    where: { id: lineId },
                    data: { decision: null, note: null, answeredAt: null, answeredById: null, answeredBySuperAdminId: null },
                })
                throw error
            }
        }

        const open = await prisma.accessReviewLine.count({ where: { reviewId: line.reviewId, decision: null } })
        if (open === 0) {
            await prisma.accessReview.updateMany({ where: { id: line.reviewId, status: "OPEN" }, data: { status: "COMPLETED", completedAt: new Date() } })
        }
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log("ANSWER_ACCESS_REVIEW", "ACCESS_REVIEW", line.reviewId, {
            userId: superAdmin ? null : actor.id, superAdminId: superAdmin ? actor.id : null,
            details: { lineId, userId: line.userId, permission: line.permission, decision: input.decision, note: input.note?.trim() || null },
        })
        const review = await prisma.accessReview.findUniqueOrThrow({ where: { id: line.reviewId }, select: SHAPE })
        return (await withBuiltIn([review]))[0]
    }
}
