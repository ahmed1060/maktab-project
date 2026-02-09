import { prisma } from "@/lib/prisma"
import { CreateClientInput, UpdateClientInput } from "../validations/client.schema"

export class ClientService {
    static async create(input: CreateClientInput, session: any) {
        const userRole = session.user.role
        const userId = session.user.id
        const userCompanyId = (session.user as any).companyId

        const { name, companyId } = input

        let targetCompanyId = userCompanyId
        if (userRole === 'SUPER_ADMIN') {
            if (companyId) targetCompanyId = companyId
            else if (!targetCompanyId) throw new Error("COMPANY_SELECTION_REQUIRED")
        } else {
            if (!targetCompanyId) throw new Error("USER_NO_COMPANY")
        }

        return await prisma.businessClient.create({
            data: {
                name,
                companyId: targetCompanyId!,
                createdById: userRole === 'SUPER_ADMIN' ? null : userId
            }
        })
    }

    static async update(input: UpdateClientInput, session: any) {
        const userRole = session.user.role
        const userId = session.user.id
        const userCompanyId = (session.user as any).companyId

        const { id, name } = input

        const client = await prisma.businessClient.findUnique({ where: { id } })
        if (!client) throw new Error("CLIENT_NOT_FOUND")

        if (userRole !== 'SUPER_ADMIN' && client.companyId !== userCompanyId) {
            throw new Error("FORBIDDEN")
        }

        return await prisma.businessClient.update({
            where: { id },
            data: {
                name,
                lastEditedById: userRole === 'SUPER_ADMIN' ? null : userId
            }
        })
    }

    static async delete(id: string, session: any) {
        const userRole = session.user.role
        const userCompanyId = (session.user as any).companyId

        const client = await prisma.businessClient.findUnique({ where: { id } })
        if (!client) throw new Error("CLIENT_NOT_FOUND")

        if (userRole !== 'SUPER_ADMIN' && client.companyId !== userCompanyId) {
            throw new Error("FORBIDDEN")
        }

        return await prisma.businessClient.delete({ where: { id } })
    }
}
