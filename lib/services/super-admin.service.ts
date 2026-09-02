import { prisma } from "@/lib/prisma"
import { SuperAdminInput } from "../validations/super-admin.schema"
import bcrypt from "bcryptjs"

export class SuperAdminService {
    static async getMany(skip: number, take: number, search?: string) {
        const where: any = {}
        if (search) {
            where.OR = [
                { id: { contains: search, mode: 'insensitive' } },
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
                    isProtected: true,
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

    /**
     * Edit is scoped to profile fields only — no password here. That's not
     * a gap: password changes for a SuperAdmin already go through the
     * existing generic PUT /api/users → UserService.update, which falls
     * back to the SuperAdmin table when no matching User row exists. That
     * path already covers self-service changes and, for a *different*
     * super admin, an admin-forced reset gated by a verification passcode.
     * This endpoint deliberately doesn't duplicate that. Authorization here
     * for the fields it does own: a super admin can always edit themselves;
     * editing a *different* super admin requires the actor be protected
     * (isProtected on their session) — see types/next-auth.d.ts and
     * lib/auth.ts for where that's stamped.
     */
    static async update(id: string, input: { firstName?: string; lastName?: string; email?: string; gender?: string }, session: any) {
        const actorId = session.user.id
        const actorIsProtected = !!session.user.isProtected

        if (id !== actorId && !actorIsProtected) {
            throw new Error('FORBIDDEN')
        }

        const data: any = {}
        if (input.firstName !== undefined) data.firstName = input.firstName
        if (input.lastName !== undefined) data.lastName = input.lastName
        if (input.email !== undefined) data.email = input.email
        if (input.gender !== undefined) data.gender = input.gender

        let updated
        try {
            updated = await prisma.superAdmin.update({ where: { id }, data })
        } catch (e: any) {
            if (e.code === 'P2025') throw new Error('SUPER_ADMIN_NOT_FOUND')
            if (e.code === 'P2002') throw new Error('EMAIL_ALREADY_EXISTS')
            throw e
        }

        const { password: _password, ...adminWithoutPassword } = updated as any
        /* eslint-disable @typescript-eslint/no-unused-vars */
        const unused = _password
        /* eslint-enable @typescript-eslint/no-unused-vars */

        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('UPDATE_SUPER_ADMIN', 'SUPER_ADMIN', id, {
            superAdminId: actorId,
            details: data
        })

        return {
            ...adminWithoutPassword,
            role: 'SUPER_ADMIN',
            status: 'ACTIVE'
        }
    }

    /**
     * The database trigger (see the isProtected migration) is the real
     * backstop here — it blocks deleting a protected row or the last
     * remaining one regardless of what this method does. This
     * authorization check exists to fail fast with a clear error instead
     * of a raw Postgres exception, and to stop a non-protected admin from
     * even attempting to delete someone else's account.
     */
    static async delete(id: string, session: any) {
        const actorId = session.user.id
        const actorIsProtected = !!session.user.isProtected

        if (!actorIsProtected) {
            throw new Error('FORBIDDEN')
        }

        try {
            await prisma.superAdmin.delete({ where: { id } })
        } catch (e: any) {
            if (e.code === 'P2025') throw new Error('SUPER_ADMIN_NOT_FOUND')
            const message = String(e.message || '')
            if (message.includes('Cannot delete a protected SuperAdmin account')) {
                throw new Error('TARGET_PROTECTED')
            }
            if (message.includes('Cannot delete the last remaining SuperAdmin account')) {
                throw new Error('LAST_SUPER_ADMIN')
            }
            throw e
        }

        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('DELETE_SUPER_ADMIN', 'SUPER_ADMIN', id, {
            superAdminId: actorId
        })
    }
}
