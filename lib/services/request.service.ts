import { prisma } from "@/lib/prisma"
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
                const admins = await tx.user.findMany({
                    where: {
                        companyId,
                        role: { in: ['ADMIN', 'TEAM_LEADER'] }
                    },
                    select: { id: true }
                })

                if (admins.length > 0) {
                    await tx.notification.createMany({
                        data: admins.map(admin => ({
                            userId: admin.id,
                            type: 'NEW_REQUEST',
                            message: `New request from ${userFirstName}: ${input.title}`,
                            relatedId: request.id
                        }))
                    })
                }
            }

            // Audit Log
            await tx.auditLog.create({
                data: {
                    action: 'CREATE_REQUEST',
                    entityType: 'REQUEST',
                    entityId: request.id,
                    userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                    superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                    details: JSON.stringify({ title: input.title, companyId })
                }
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
        else if (['ADMIN', 'TEAM_LEADER'].includes(userRole)) {
            if (request.companyId !== userCompanyId) throw new Error("ACCESS_DENIED")
        } else {
            if (request.userId !== userId) throw new Error("ACCESS_DENIED")
        }

        return request
    }

    static async updateStatus(id: string, status: string, session: any) {
        const userRole = session.user.role
        const userCompanyId = session.user.companyId
        const updaterName = `${session.user.firstName || ''} ${session.user.lastName || ''}`.trim() || session.user?.name || 'Someone'

        if (!['SUPER_ADMIN', 'ADMIN', 'TEAM_LEADER'].includes(userRole)) throw new Error("ACCESS_DENIED")
        if (!['PENDING', 'IN_PROGRESS', 'COMPLETED'].includes(status)) throw new Error("INVALID_STATUS")

        return await prisma.$transaction(async (tx) => {
            const request = await tx.request.findUnique({ where: { id } })
            if (!request) throw new Error("REQUEST_NOT_FOUND")

            if (userRole !== 'SUPER_ADMIN' && request.companyId !== userCompanyId) throw new Error("ACCESS_DENIED")

            const data: any = { status }
            if (status === 'IN_PROGRESS') data.inProgressAt = new Date()
            if (status === 'COMPLETED') data.completedAt = new Date()

            const updated = await tx.request.update({ where: { id }, data })

            // Audit Log
            await tx.auditLog.create({
                data: {
                    action: 'UPDATE_REQUEST_STATUS',
                    entityType: 'REQUEST',
                    entityId: id,
                    userId: userRole !== 'SUPER_ADMIN' ? session.user.id : null,
                    superAdminId: userRole === 'SUPER_ADMIN' ? session.user.id : null,
                    details: JSON.stringify({ oldStatus: request.status, newStatus: status })
                }
            })

            // Notify user
            const updaterRole = userRole.replace(/_/g, ' ')
            const statusText = status.replace(/_/g, ' ')

            await tx.notification.create({
                data: {
                    userId: request.userId,
                    type: 'REQUEST_STATUS_UPDATED',
                    message: `Your request "${request.title}" is ${statusText}. (Done by ${updaterRole} ${updaterName})`,
                    relatedId: id
                }
            })

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
        else if (['ADMIN', 'TEAM_LEADER'].includes(userRole)) {
            if (request.companyId !== userCompanyId) throw new Error("ACCESS_DENIED")
        } else {
            if (request.userId !== userId) throw new Error("ACCESS_DENIED")
        }

        const result = await prisma.request.delete({ where: { id } })

        // Audit Log
        await prisma.auditLog.create({
            data: {
                action: 'DELETE_REQUEST',
                entityType: 'REQUEST',
                entityId: id,
                userId: userRole !== 'SUPER_ADMIN' ? userId : null,
                superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
                details: JSON.stringify({ title: request.title, status: request.status })
            }
        })

        return result
    }
}
