import { prisma } from "@/lib/prisma"
import { CreateSectionInput, UpdateSectionInput } from "../validations/section.schema"
import { can } from "@/lib/permissions/can"

export class SectionService {
    static async create(input: CreateSectionInput, session: any) {
        const userId = session.user.id
        const userRole = session.user.role
        const { title, clientId } = input

        const client = await prisma.businessClient.findUnique({
            where: { id: clientId },
            select: { companyId: true }
        })

        if (!client) throw new Error("CLIENT_NOT_FOUND")

        if (!can(session.user, "clients.contribute", { companyId: client.companyId })) {
            throw new Error("ACCESS_DENIED")
        }

        const section = await prisma.businessClientSection.create({
            data: {
                title,
                clientId,
                createdById: userRole === 'SUPER_ADMIN' ? null : userId
            }
        })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('CREATE_SECTION', 'SECTION', section.id, {
            userId: userRole !== 'SUPER_ADMIN' ? userId : null,
            superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
            details: { title, clientId }
        })

        return section
    }

    static async update(input: UpdateSectionInput, session: any) {
        const userId = session.user.id
        const userRole = session.user.role
        const { id, title } = input

        const section = await prisma.businessClientSection.findUnique({
            where: { id },
            include: { client: { select: { companyId: true } } }
        })

        if (!section) throw new Error("SECTION_NOT_FOUND")

        if (!can(session.user, "clients.edit", { companyId: section.client.companyId })) {
            throw new Error("ACCESS_DENIED")
        }

        const updated = await prisma.businessClientSection.update({
            where: { id },
            data: {
                title,
                lastEditedById: userRole === 'SUPER_ADMIN' ? null : userId
            }
        })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('UPDATE_SECTION', 'SECTION', id, {
            userId: userRole !== 'SUPER_ADMIN' ? userId : null,
            superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
            details: { title }
        })

        return updated
    }

    static async delete(id: string, session: any) {
        const userRole = session.user.role
        const userId = session.user.id

        const section = await prisma.businessClientSection.findUnique({
            where: { id },
            include: { client: { select: { companyId: true } } }
        })

        if (!section) throw new Error("SECTION_NOT_FOUND")

        if (!can(session.user, "clients.delete", { companyId: section.client.companyId })) {
            throw new Error("ACCESS_DENIED")
        }

        const result = await prisma.businessClientSection.delete({ where: { id } })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('DELETE_SECTION', 'SECTION', id, {
            userId: userRole !== 'SUPER_ADMIN' ? userId : null,
            superAdminId: userRole === 'SUPER_ADMIN' ? userId : null,
            details: { title: section.title, clientId: section.clientId }
        })

        return result
    }
}
