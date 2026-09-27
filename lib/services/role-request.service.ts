import { prisma } from "@/lib/prisma"
import { roleParam } from "@/lib/notice"
import { can } from "@/lib/permissions/can"
import { holdersOf } from "@/lib/permissions/holders"
import { personTarget } from "@/lib/security"
import { addWorkingDays } from "@/lib/working-days"
import { DEFAULT_TIME_ZONE } from "@/lib/time"
import { RoleAssignmentService } from "./role-assignment.service"
import { RoleService } from "./role.service"
import type { Prisma } from "@prisma/client"

/**
 * Role assignment requests (ROLES_PLAN.md §6.12).
 *
 * HR assigns roles to new hires in practice, but giving a role is giving
 * access, so somebody who holds `employees.request_role` asks and somebody who
 * holds `employees.assign_role` decides. The person keeps their role until
 * then.
 *
 * The limits are the assignment rules (§4.2), checked for the requester when
 * they ask and again when it is decided — their access may have changed in
 * between — and for the decider through the ordinary assignment, which is
 * what approving does:
 * - only that company's roles, never an ADMIN-based one;
 * - never for oneself, and never decided by whoever asked;
 * - only roles whose grants the requester, and the decider, hold.
 */

const AT_WORK = ["ACTIVE", "OFFLINE"] as const

/** How long a request waits before the deciders are reminded of it. */
export const REMIND_AFTER_WORKING_DAYS = 3

type Session = { user: { id: string; role: string; companyId?: string | null; grants?: string | null } }

const link = (id: string) => `/dashboard/role-requests?highlight=${id}`
const name = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`

const SHAPE = {
    id: true, companyId: true, status: true, note: true, decisionNote: true, createdAt: true, decidedAt: true, actingUntil: true,
    user: { select: { id: true, firstName: true, lastName: true, assignedRole: { select: { id: true, name: true, builtIn: true } } } },
    role: { select: { id: true, name: true, baseRole: true, builtIn: true } },
    requestedBy: { select: { id: true, firstName: true, lastName: true } },
    decidedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.RoleRequestSelect

/** Who decides a company's requests: everybody at work there who may assign. */
async function deciders(companyId: string, except: string[]) {
    const people = await prisma.user.findMany({
        where: { companyId, status: { in: [...AT_WORK] }, id: { notIn: except }, ...holdersOf("employees.assign_role") },
        select: { id: true },
    })
    return people.map(p => p.id)
}

function audit(action: string, id: string, session: Session, details: Record<string, unknown>, tx?: Prisma.TransactionClient) {
    return import("./audit-log.service").then(({ AuditLogService }) => AuditLogService.log(action, "ROLE_REQUEST", id, {
        tx,
        userId: session.user.role !== "SUPER_ADMIN" ? session.user.id : null,
        superAdminId: session.user.role === "SUPER_ADMIN" ? session.user.id : null,
        details,
    }))
}

export class RoleRequestService {
    /** Ask for `roleId` for `userId`. Throws the assignment rules' refusals. */
    static async create(input: { userId: string; roleId: string; note?: string | null; actingUntil?: string | Date | null }, session: Session) {
        const actor = session.user
        if (input.userId === actor.id) throw new Error("OWN_ROLE")
        const person = await personTarget(input.userId)
        if (!person?.companyId) throw new Error("USER_NOT_FOUND")
        if (!can(actor, "employees.request_role", person)) throw new Error("FORBIDDEN")

        const target = await prisma.user.findUnique({
            where: { id: input.userId },
            select: { id: true, role: true, roleId: true, companyId: true, firstName: true, lastName: true },
        })
        if (!target?.companyId) throw new Error("USER_NOT_FOUND")
        if (target.roleId === input.roleId) throw new Error("SAME_ROLE")
        const actingUntil = input.actingUntil
            ? RoleAssignmentService.returnOn(input.actingUntil, (await prisma.company.findUnique({ where: { id: target.companyId }, select: { timezone: true } }))?.timezone ?? DEFAULT_TIME_ZONE)
            : null
        if (actingUntil && actingUntil <= new Date()) throw new Error("ACTING_END_IN_PAST")
        // Asking to change an Admin is asking to act on one (§4.2, rule 7).
        RoleAssignmentService.onlySuperAdminActsOnAdmins(actor, target)
        // Rules 1-4, for the one asking.
        await RoleAssignmentService.chosen(prisma, actor, input.roleId, { companyId: target.companyId, userId: target.id })

        const request = await prisma.$transaction(async tx => {
            const created = await tx.roleRequest.create({
                data: {
                    companyId: target.companyId!, userId: target.id, roleId: input.roleId, requestedById: actor.id,
                    note: input.note || null, actingUntil,
                },
                select: SHAPE,
            }).catch(error => {
                if (error?.code === "P2002") throw new Error("ALREADY_PENDING")
                throw error
            })
            await audit("CREATE_ROLE_REQUEST", created.id, session, {
                userId: target.id, from: target.roleId, to: input.roleId, note: input.note || null,
            }, tx)
            return created
        })

        const { NotificationService } = await import("./notification.service")
        await NotificationService.notifyMany(
            await deciders(target.companyId, [actor.id, target.id]),
            "ROLE_CHANGE_ASKED",
            { key: "notice_role_request_asked", params: { by: name(request.requestedBy), person: name(request.user), role: roleParam(request.role) } },
            link(request.id),
        )
        return request
    }

    /**
     * Approve or reject. Approving applies the role through UserService.update
     * — the same assignment as choosing it directly, with the same checks for
     * the one deciding (rules 1-4, the team hand-off, the last Admin).
     */
    static async decide(
        id: string,
        input: { approve: boolean; note?: string | null; reassignReportsTo?: string | null },
        session: Session,
    ) {
        const actor = session.user
        const request = await prisma.roleRequest.findUnique({ where: { id }, select: { ...SHAPE, userId: true, roleId: true, requestedById: true, actingUntil: true } })
        if (!request) throw new Error("REQUEST_NOT_FOUND")
        const person = await personTarget(request.userId)
        if (!person || !can(actor, "employees.assign_role", person)) throw new Error("FORBIDDEN")
        // Nobody decides what they asked for (§4.2, rule 6).
        if (actor.id === request.requestedById) throw new Error("OWN_REQUEST")
        if (!input.approve && !input.note?.trim()) throw new Error("REASON_REQUIRED")

        // Claimed before anything is applied, so two deciders cannot both act.
        const claimed = await prisma.roleRequest.updateMany({
            where: { id, status: "PENDING" },
            data: {
                status: input.approve ? "APPROVED" : "REJECTED",
                decidedById: actor.role === "SUPER_ADMIN" ? null : actor.id,
                decidedAt: new Date(),
                decisionNote: input.note?.trim() || null,
            },
        })
        if (claimed.count === 0) throw new Error("ALREADY_DECIDED")

        if (input.approve) {
            try {
                // Rule 4 again for the one who asked, with what their role holds
                // now rather than when they asked.
                const requester = await prisma.user.findUnique({ where: { id: request.requestedById }, select: { id: true, role: true } })
                const { grants } = await RoleService.forToken(request.requestedById)
                await RoleAssignmentService.chosen(prisma, { id: requester?.id, role: requester?.role, grants }, request.roleId, {
                    companyId: request.companyId, userId: request.userId,
                })
                const { UserService } = await import("./user.service")
                await UserService.update({
                    id: request.userId, roleId: request.roleId, reassignReportsTo: input.reassignReportsTo,
                    // An acting role asked for stays one (§6.13).
                    ...(request.actingUntil ? { actingUntil: request.actingUntil } : {}),
                } as any, session)
            } catch (error) {
                // Not applied, so not decided: it goes back to waiting.
                await prisma.roleRequest.update({
                    where: { id },
                    data: { status: "PENDING", decidedById: null, decidedAt: null, decisionNote: null },
                })
                throw error
            }
        }

        await audit(input.approve ? "APPROVE_ROLE_REQUEST" : "REJECT_ROLE_REQUEST", id, session, {
            userId: request.userId, role: request.roleId, note: input.note?.trim() || null,
        })
        const { NotificationService } = await import("./notification.service")
        await NotificationService.notify(
            request.requestedById,
            input.approve ? "ROLE_CHANGE_APPROVED" : "ROLE_CHANGE_REJECTED",
            input.approve
                ? { key: "notice_role_request_approved", params: { person: name(request.user), role: roleParam(request.role) } }
                : { key: "notice_role_request_declined", params: { person: name(request.user), role: roleParam(request.role), note: input.note!.trim() } },
            link(id),
        )
        if (input.approve) {
            await NotificationService.notify(request.userId, "ROLE_CHANGE_APPROVED", { key: "notice_role_now", params: { role: roleParam(request.role) } }, link(id))
        }
        return RoleRequestService.get(id)
    }

    /** Withdraw a request one made, while it waits. */
    static async cancel(id: string, session: Session) {
        const request = await prisma.roleRequest.findUnique({ where: { id }, select: { requestedById: true, status: true } })
        if (!request) throw new Error("REQUEST_NOT_FOUND")
        if (request.requestedById !== session.user.id) throw new Error("FORBIDDEN")
        const done = await prisma.roleRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date() } })
        if (done.count === 0) throw new Error("ALREADY_DECIDED")
        await audit("CANCEL_ROLE_REQUEST", id, session, {})
        return RoleRequestService.get(id)
    }

    static async get(id: string) {
        const request = await prisma.roleRequest.findUnique({ where: { id }, select: SHAPE })
        if (!request) throw new Error("REQUEST_NOT_FOUND")
        return request
    }

    /**
     * The requests somebody may see: a company's, for whoever decides them;
     * the ones they made, for whoever only asks. The Super Admin names the
     * company.
     */
    static async list(session: Session, filter: { companyId?: string | null; status?: string | null; userId?: string | null }) {
        const actor = session.user
        const companyId = actor.role === "SUPER_ADMIN" ? filter.companyId : actor.companyId
        if (!companyId) return []
        const where: Prisma.RoleRequestWhereInput = { companyId }
        if (filter.status) where.status = filter.status as any
        if (filter.userId) where.userId = filter.userId
        if (actor.role !== "SUPER_ADMIN" && !can(actor, "employees.assign_role")) {
            if (!can(actor, "employees.request_role")) return []
            where.requestedById = actor.id
        }
        return prisma.roleRequest.findMany({ where, select: SHAPE, orderBy: { createdAt: "desc" }, take: 200 })
    }

    /**
     * Remind the deciders of requests left waiting (§6.12), so a new hire is
     * not left on the default role by oversight. Once per interval per
     * request, counted in working days in the company's calendar.
     */
    static async remindStale(now: Date = new Date()) {
        const waiting = await prisma.roleRequest.findMany({
            where: { status: "PENDING" },
            select: {
                id: true, companyId: true, createdAt: true, remindedAt: true, requestedById: true, userId: true,
                company: { select: { timezone: true } },
                user: { select: { firstName: true, lastName: true } },
                role: { select: { name: true, builtIn: true } },
            },
        })
        const { NotificationService } = await import("./notification.service")
        let reminded = 0
        for (const r of waiting) {
            const since = r.remindedAt ?? r.createdAt
            if (addWorkingDays(since, REMIND_AFTER_WORKING_DAYS, r.company.timezone) > now) continue
            await NotificationService.notifyMany(
                await deciders(r.companyId, [r.requestedById, r.userId]),
                "ROLE_CHANGE_WAITING",
                { key: "notice_role_request_waiting", params: { person: name(r.user), role: roleParam(r.role) } },
                link(r.id),
            )
            await prisma.roleRequest.update({ where: { id: r.id }, data: { remindedAt: now } })
            reminded++
        }
        return { waiting: waiting.length, reminded }
    }
}
