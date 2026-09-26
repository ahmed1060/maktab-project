import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions/can"
import { holdersOf } from "@/lib/permissions/holders"
import { scopesToTeam } from "@/lib/team-scope"
import { verifyResourceAccess } from "@/lib/security"
import { CreateRequestInput } from "../validations/request.schema"

export class RequestService {
    static async getMany(where: any, skip: number, limit: number, sortBy: string, order: string) {
        const [requests, total] = await Promise.all([
            prisma.request.findMany({
                where,
                include: {
                    user: {
                        select: {
                            id: true, firstName: true, lastName: true, email: true, avatar: true, role: true
                        }
                    }
                },
                orderBy: { [sortBy]: order },
                skip,
                take: limit
            }),
            prisma.request.count({ where })
        ])

        return { requests, total }
    }

    static async create(input: CreateRequestInput, session: any) {
        const userId = session.user.id
        const userRole = session.user.role
        const userFirstName = session.user.firstName || session.user.name
        let companyId = session.user.companyId

        if (userRole === 'SUPER_ADMIN' && input.companyId) {
            companyId = input.companyId
        }

        return await prisma.$transaction(async (tx) => {
            const request = await tx.request.create({
                data: {
                    title: input.title,
                    details: input.details,
                    userId,
                    companyId,
                    status: 'PENDING'
                }
            })

            if (companyId) {
                // Who should hear about this: the company's Admins, and this
                // person's own team leader.
                //
                // It used to be every ADMIN and every TEAM_LEADER in the
                // company, which was right when a leader could act on anybody.
                // Now they cannot, so most of those notifications were an
                // invitation to open a request the recipient is refused
                // access to — and the ones that mattered were buried among
                // them. A notification nobody can act on is worse than no
                // notification, because it teaches people to ignore the rest.
                //
                // Read inside the transaction: the requester's leader is being
                // asked for at the same moment the request is written, so it
                // should be the leader they had when they wrote it.
                const requester = await tx.user.findUnique({
                    where: { id: userId },
                    select: { teamLeaderId: true },
                })

                const admins = await tx.user.findMany({
                    where: {
                        companyId,
                        OR: [
                            // Whoever decides requests company-wide.
                            holdersOf("requests.review", "COMPANY"),
                            // The requester's own leader, whose role decides
                            // their team's. `?? ''` rather than omitting the
                            // branch: an employee with no leader simply matches
                            // nothing here, instead of the condition collapsing
                            // to "any id" the way an undefined would.
                            { id: requester?.teamLeaderId ?? '', ...holdersOf("requests.review", "TEAM") },
                        ],
                    },
                    select: { id: true }
                })

                if (admins.length > 0) {
                    const { NotificationService } = await import("./notification.service")
                    await NotificationService.notifyMany(
                        admins.map(admin => admin.id),
                        'NEW_REQUEST',
                        `New request from ${userFirstName}: ${input.title}`,
                        request.id,
                        tx
                    )
                }
            }

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('CREATE_REQUEST', 'REQUEST', request.id, {
                tx,
                userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                details: { title: input.title, companyId }
            })

            return request
        })
    }

    static async getById(id: string, session: any) {
        const userRole = session.user.role
        const userId = session.user.id
        const userCompanyId = session.user.companyId

        const request = await prisma.request.findUnique({
            where: { id },
            include: { user: { select: { firstName: true, lastName: true, email: true, avatar: true } } }
        })

        if (!request) throw new Error("REQUEST_NOT_FOUND")

        // Authorization
        if (userRole === 'SUPER_ADMIN') { /* OK */ }
        else if (can(session.user, "requests.view")) {
            if (request.companyId !== userCompanyId) throw new Error("ACCESS_DENIED")
            await requireTeamReach(session, request.userId)
        } else {
            if (request.userId !== userId) throw new Error("ACCESS_DENIED")
        }

        return request
    }

    static async updateStatus(id: string, status: string, session: any) {
        const userRole = session.user.role
        const userCompanyId = session.user.companyId
        const updaterName = `${session.user.firstName || ''} ${session.user.lastName || ''}`.trim() || session.user?.name || 'Someone'

        if (!can(session.user, "requests.review")) throw new Error("ACCESS_DENIED")
        if (!['PENDING', 'IN_PROGRESS', 'COMPLETED'].includes(status)) throw new Error("INVALID_STATUS")

        return await prisma.$transaction(async (tx) => {
            const request = await tx.request.findUnique({ where: { id } })
            if (!request) throw new Error("REQUEST_NOT_FOUND")

            if (userRole !== 'SUPER_ADMIN' && request.companyId !== userCompanyId) throw new Error("ACCESS_DENIED")
            await requireTeamReach(session, request.userId)

            // --- NEW: State Transition Guard ---
            if (request.status === 'COMPLETED' && ['PENDING', 'IN_PROGRESS'].includes(status)) {
                throw new Error("COMPLETED_REQUEST_STATUS_LOCKED")
            }

            const data: any = { status }
            if (status === 'IN_PROGRESS') data.inProgressAt = new Date()
            if (status === 'COMPLETED') data.completedAt = new Date()

            const updated = await tx.request.update({ where: { id }, data })

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('UPDATE_REQUEST_STATUS', 'REQUEST', id, {
                tx,
                userId: userRole !== 'SUPER_ADMIN' ? session.user.id : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? session.user.id : null,
                details: { oldStatus: request.status, newStatus: status }
            })

            // Notify user (Centralized)
            const updaterRole = userRole.replace(/_/g, ' ')
            const statusText = status.replace(/_/g, ' ')
            const { NotificationService } = await import("./notification.service")
            await NotificationService.notify(
                request.userId,
                'REQUEST_STATUS_UPDATED',
                `Your request "${request.title}" is ${statusText}. (Done by ${updaterRole} ${updaterName})`,
                id,
                tx
            )

            return updated
        })
    }

    static async delete(id: string, session: any) {
        const userRole = session.user.role
        const userId = session.user.id
        const userCompanyId = session.user.companyId

        const request = await prisma.request.findUnique({ where: { id } })
        if (!request) throw new Error("REQUEST_NOT_FOUND")

        // Completed requests can only be deleted by Super Admin
        if (request.status === 'COMPLETED' && userRole !== 'SUPER_ADMIN') throw new Error("COMPLETED_REQUEST_DELETE_FORBIDDEN")

        // Authorization
        if (userRole === 'SUPER_ADMIN') { /* OK */ }
        else if (can(session.user, "requests.review")) {
            if (request.companyId !== userCompanyId) throw new Error("ACCESS_DENIED")
            await requireTeamReach(session, request.userId)
        } else {
            if (request.userId !== userId) throw new Error("ACCESS_DENIED")
        }

        const result = await prisma.request.delete({ where: { id } })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('DELETE_REQUEST', 'REQUEST', id, {
            userId: userRole !== 'SUPER_ADMIN' ? userId : null,
            superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
            details: { title: request.title, status: request.status }
        })

        return result
    }
}

/**
 * A Team Leader reaches only requests raised by their team, or by themselves —
 * the same rule the request list applies. Viewing, changing and deleting one
 * request checked only the company, so a Team Leader could act on requests
 * outside their team, the Admin's own included. verifyResourceAccess on the
 * person who raised it is the team rule every other per-person check uses.
 */
async function requireTeamReach(session: any, requesterId: string) {
    if (!scopesToTeam(session.user, "requests.view")) return
    if (!(await verifyResourceAccess(session, requesterId, 'USER'))) throw new Error("ACCESS_DENIED")
}
