import { prisma } from "@/lib/prisma"
import { SuperAdminInput } from "../validations/super-admin.schema"
import bcrypt from "bcryptjs"

export class SuperAdminService {
    static async getMany(skip: number, take: number, search?: string) {
        const where: any = {}
        if (search) {
            where.OR = [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } }
            ]
        }

        const [admins, total] = await Promise.all([
            prisma.superAdmin.findMany({
                where,
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    username: true,
                    gender: true,
                    avatar: true,
                },
                orderBy: { firstName: 'asc' },
                skip,
                take
            }),
            prisma.superAdmin.count({ where })
        ])

        return {
            admins: admins.map(admin => ({
                ...admin,
                role: 'SUPER_ADMIN',
                status: 'ACTIVE',
                companyId: null
            })),
            total
        }
    }

    static async create(input: SuperAdminInput, session?: any) {
        const hashedPassword = await bcrypt.hash(input.password, 12)

        const newAdmin = await prisma.superAdmin.create({
            data: {
                firstName: input.firstName,
                lastName: input.lastName,
                email: input.email,
                username: input.username || "",
                password: hashedPassword,
                gender: input.gender || 'MALE'
            }
        })

        const { password: _password, ...adminWithoutPassword } = newAdmin as any
        /* eslint-disable @typescript-eslint/no-unused-vars */
        const unused = _password
        /* eslint-enable @typescript-eslint/no-unused-vars */

        // Audit Log (Centralized)
        if (session) {
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('CREATE_SUPER_ADMIN', 'SUPER_ADMIN', newAdmin.id, {
                superAdminId: session.user.id,
                details: { email: input.email }
            })
        }

        return {
            ...adminWithoutPassword,
            role: 'SUPER_ADMIN',
            status: 'ACTIVE'
        }
    }
}
