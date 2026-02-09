import { prisma } from "@/lib/prisma"
import { CreateSectionInput, UpdateSectionInput } from "../validations/section.schema"

export class SectionService {
    static async create(input: CreateSectionInput, session: any) {
        const userId = session.user.id
        const userRole = session.user.role
        const userCompanyId = (session.user as any).companyId
        const { title, clientId } = input

        const client = await prisma.businessClient.findUnique({
            where: { id: clientId },
            select: { companyId: true }
        })

        if (!client) throw new Error("CLIENT_NOT_FOUND")

        // Authorization
        if (userRole !== 'SUPER_ADMIN') {
            if (!userCompanyId || userCompanyId !== client.companyId) {
                throw new Error("ACCESS_DENIED")
            }
        }

        return await prisma.businessClientSection.create({
            data: {
                title,
                clientId,
                createdById: userRole === 'SUPER_ADMIN' ? null : userId
            }
        })
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

        if (userRole !== 'SUPER_ADMIN') {
            const userCompanyId = (session.user as any).companyId
            if (section.client.companyId !== userCompanyId) {
                throw new Error("ACCESS_DENIED")
            }
        }

        return await prisma.businessClientSection.update({
            where: { id },
            data: {
                title,
                lastEditedById: userRole === 'SUPER_ADMIN' ? null : userId
            }
        })
    }

    static async delete(id: string, session: any) {
        const userRole = session.user.role

        const section = await prisma.businessClientSection.findUnique({
            where: { id },
            include: { client: { select: { companyId: true } } }
        })

        if (!section) throw new Error("SECTION_NOT_FOUND")

        if (userRole !== 'SUPER_ADMIN') {
            const userCompanyId = (session.user as any).companyId
            if (section.client.companyId !== userCompanyId) {
                throw new Error("ACCESS_DENIED")
            }
        }

        return await prisma.businessClientSection.delete({ where: { id } })
    }
}
