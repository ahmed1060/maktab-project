import { prisma } from "@/lib/prisma"
import { RoleChangeRequestStatus } from "@prisma/client"
import { roleParam } from "@/lib/notice"
import { can } from "@/lib/permissions/can"
import type { Prisma } from "@prisma/client"

/**
 * Role change requests (ROLES_PLAN.md §6.9): a company asks the Super Admin to
 * change one of its roles, or make a new one. Only the Super Admin edits
 * roles; this is the channel, so the request is written down with a status
 * both sides can see. Asked by whoever may give roles in the company — its
 * Admins — and answered by the Super Admin, who makes the change itself in
 * the ordinary way.
 */

type Session = { user: { id: string; role: string; companyId?: string | null; grants?: string | null } }

const SHAPE = {
    id: true, companyId: true, description: true, status: true, response: true, createdAt: true, respondedAt: true,
    company: { select: { name: true } },
    role: { select: { id: true, name: true, builtIn: true } },
    requestedBy: { select: { id: true, firstName: true, lastName: true } },
    respondedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.RoleChangeRequestSelect

export class RoleChangeRequestService {
    static mayAsk(session: Session) {
        return session.user.role !== "SUPER_ADMIN" && !!session.user.companyId && can(session.user, "employees.assign_role")
    }

    static async create(input: { roleId?: string | null; description: string }, session: Session) {
        if (!RoleChangeRequestService.mayAsk(session)) throw new Error("FORBIDDEN")
        const companyId = session.user.companyId!
        if (input.roleId) {
            const role = await prisma.role.findUnique({ where: { id: input.roleId }, select: { companyId: true } })
            if (!role || role.companyId !== companyId) throw new Error("ROLE_NOT_IN_COMPANY")
        }
        const request = await prisma.roleChangeRequest.create({
            data: { companyId, roleId: input.roleId || null, requestedById: session.user.id, description: input.description },
            select: SHAPE,
        })
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log("CREATE_ROLE_CHANGE_REQUEST", "ROLE_CHANGE_REQUEST", request.id, {
            userId: session.user.id, details: { roleId: input.roleId || null, description: input.description },
        })
        const superAdmins = await prisma.superAdmin.findMany({ select: { id: true } })
        const { NotificationService } = await import("./notification.service")
        await NotificationService.notifySuperAdmins(
            superAdmins.map(s => s.id),
            "ROLE_CHANGE_FOR_SUPER_ADMIN",
            { key: "notice_role_change_asked", params: { company: request.company.name, what: request.role ? { key: "notice_the_role", params: { role: roleParam(request.role) } } : { key: "notice_its_roles" } } },
            `/dashboard/role-change-requests?highlight=${request.id}`,
        )
        return request
    }

    /** The Super Admin's queue, or a company's own requests. */
    static async list(session: Session, filter: { status?: string | null; companyId?: string | null }) {
        const where: Prisma.RoleChangeRequestWhereInput = {}
        // A status that isn't one matches nothing, rather than reaching the
        // database as an enum value it can't read (a 500).
        if (filter.status) where.status = (Object.values(RoleChangeRequestStatus) as string[]).includes(filter.status) ? filter.status as RoleChangeRequestStatus : { in: [] }
        if (session.user.role === "SUPER_ADMIN") {
            if (filter.companyId) where.companyId = filter.companyId
        } else {
            if (!RoleChangeRequestService.mayAsk(session)) throw new Error("FORBIDDEN")
            where.companyId = session.user.companyId!
        }
        return prisma.roleChangeRequest.findMany({ where, select: SHAPE, orderBy: { createdAt: "desc" }, take: 200 })
    }

    /** The Super Admin marks it done or declined, saying why. */
    static async respond(id: string, input: { status: "DONE" | "DECLINED"; response?: string | null }, session: Session) {
        if (session.user.role !== "SUPER_ADMIN") throw new Error("FORBIDDEN")
        if (input.status === "DECLINED" && !input.response?.trim()) throw new Error("REASON_REQUIRED")
        const done = await prisma.roleChangeRequest.updateMany({
            where: { id, status: "OPEN" },
            data: { status: input.status, response: input.response?.trim() || null, respondedById: session.user.id, respondedAt: new Date() },
        })
        if (done.count === 0) {
            if (!(await prisma.roleChangeRequest.findUnique({ where: { id }, select: { id: true } }))) throw new Error("REQUEST_NOT_FOUND")
            throw new Error("ALREADY_DECIDED")
        }
        const request = await prisma.roleChangeRequest.findUnique({ where: { id }, select: { ...SHAPE, requestedById: true } })
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log(input.status === "DONE" ? "COMPLETE_ROLE_CHANGE_REQUEST" : "DECLINE_ROLE_CHANGE_REQUEST", "ROLE_CHANGE_REQUEST", id, {
            superAdminId: session.user.id, details: { response: input.response?.trim() || null },
        })
        const { NotificationService } = await import("./notification.service")
        await NotificationService.notify(
            request!.requestedById,
            input.status === "DONE" ? "ROLE_CHANGE_DONE" : "ROLE_CHANGE_DECLINED",
            input.status === "DONE"
                ? { key: "notice_role_change_done", params: { response: request!.response ? ` ${request!.response}` : "" } }
                : { key: "notice_role_change_declined", params: { response: request!.response ?? "" } },
            `/dashboard/roles-and-access?tab=changes&highlight=${id}`,
        )
        return request
    }
}
