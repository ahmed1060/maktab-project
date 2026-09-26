import { prisma } from "@/lib/prisma"
import { can } from "@/lib/permissions/can"
import { CreateProfileRequestInput } from "../validations/profile.schema"

export class ProfileService {
    static async getMany(where: any, skip: number, take: number) {
        const [requests, total] = await Promise.all([
            prisma.profileUpdateRequest.findMany({
                where,
                include: {
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true,
                            role: true,
                            company: { select: { name: true } }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take
            }),
            prisma.profileUpdateRequest.count({ where })
        ])

        return { requests, total }
    }

    static async createRequest(input: CreateProfileRequestInput, session: any) {
        const userId = session.user.id

        const existing = await prisma.profileUpdateRequest.findFirst({
            where: { userId, status: 'PENDING' }
        })

        if (existing) throw new Error("PENDING_REQUEST_EXISTS")

        const user = await prisma.user.findUnique({ where: { id: userId } })
        if (!user) throw new Error("USER_NOT_FOUND")

        if (user.firstName === input.newFirstName && user.lastName === input.newLastName) {
            throw new Error("NAME_IDENTICAL")
        }

        return await prisma.profileUpdateRequest.create({
            data: {
                userId,
                oldFirstName: user.firstName,
                oldLastName: user.lastName,
                newFirstName: input.newFirstName,
                newLastName: input.newLastName,
                status: 'PENDING'
            }
        })
    }

    static async approveRequest(id: string, adminNote: string, session: any) {
        if (!can(session.user, "profile_requests.review")) throw new Error("ACCESS_DENIED")

        const request = await prisma.profileUpdateRequest.findUnique({ where: { id } })
        if (!request) throw new Error("REQUEST_NOT_FOUND")
        if (request.status !== 'PENDING') throw new Error("REQUEST_ALREADY_PROCESSED")

        const { verifyResourceAccess } = await import("@/lib/security")
        const hasAccess = await verifyResourceAccess(session, request.userId, 'USER')
        if (!hasAccess) throw new Error("ACCESS_DENIED")

        return await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: request.userId },
                data: { firstName: request.newFirstName, lastName: request.newLastName }
            })
            await tx.profileUpdateRequest.update({
                where: { id },
                data: { status: 'APPROVED', adminNote }
            })

            // Notify user (Centralized)
            const { NotificationService } = await import("./notification.service")
            await NotificationService.notify(
                request.userId,
                'PROFILE_UPDATE',
                `Your name change request has been approved! Your name is now ${request.newFirstName} ${request.newLastName}.`,
                request.userId,
                tx
            )

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('APPROVE_PROFILE_UPDATE', 'USER', request.userId, {
                tx,
                userId: session.user.role !== 'SUPER_ADMIN' ? session.user.id : null,
                superAdminId: session.user.role === 'SUPER_ADMIN' ? session.user.id : null,
                details: { requestId: id, oldName: `${request.oldFirstName} ${request.oldLastName}`, newName: `${request.newFirstName} ${request.newLastName}`, adminNote }
            })
        })
    }

    static async rejectRequest(id: string, adminNote: string, session: any) {
        if (!can(session.user, "profile_requests.review")) throw new Error("ACCESS_DENIED")

        const request = await prisma.profileUpdateRequest.findUnique({ where: { id } })
        if (!request) throw new Error("REQUEST_NOT_FOUND")
        if (request.status !== 'PENDING') throw new Error("REQUEST_ALREADY_PROCESSED")

        const { verifyResourceAccess } = await import("@/lib/security")
        const hasAccess = await verifyResourceAccess(session, request.userId, 'USER')
        if (!hasAccess) throw new Error("ACCESS_DENIED")

        return await prisma.$transaction(async (tx) => {
            await tx.profileUpdateRequest.update({
                where: { id },
                data: { status: 'REJECTED', adminNote }
            })

            // Notify user (Centralized)
            const { NotificationService } = await import("./notification.service")
            await NotificationService.notify(
                request.userId,
                'PROFILE_UPDATE_REJECTED',
                `Your name change request has been rejected.${adminNote ? ` Note: ${adminNote}` : ''}`,
                request.userId,
                tx
            )

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('REJECT_PROFILE_UPDATE', 'USER', request.userId, {
                tx,
                userId: session.user.role !== 'SUPER_ADMIN' ? session.user.id : null,
                superAdminId: session.user.role === 'SUPER_ADMIN' ? session.user.id : null,
                details: { requestId: id, name: `${request.oldFirstName} ${request.oldLastName}`, adminNote }
            })
        })
    }
}
