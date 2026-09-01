import { prisma } from "@/lib/prisma"
import { VerificationService } from "./verification.service"
import { supabase } from "@/lib/storage"
import bcrypt from "bcryptjs"
import { generateUsername } from "@/lib/username"
import { generateTempPassword } from "@/lib/generate-password"
import { getEgyptNow } from "@/lib/time"
import { CreateUserInput, UpdateUserInput } from "../validations/user.schema"

export class UserService {
    static async create(input: CreateUserInput, session: any) {
        const userRole = session.user.role
        const { firstName, lastName, email, password, role, gender, companyId, salary, dayOffCredit, baseDayOffCredit, username } = input

        // 1. Role Restrictions
        const newUserRole = role || 'EMPLOYEE'
        if ((newUserRole === 'ADMIN' || newUserRole === 'SUPER_ADMIN') && userRole !== 'SUPER_ADMIN') {
            throw new Error("ONLY_SUPER_ADMIN_CAN_CREATE_ADMIN")
        }

        // 2. Company Context
        let targetCompanyId = (session.user as any).companyId
        if (userRole === 'SUPER_ADMIN' && companyId) targetCompanyId = companyId

        if (!targetCompanyId && userRole !== 'SUPER_ADMIN') throw new Error("TARGET_COMPANY_NOT_FOUND")

        // 3. Security
        const existingUser = await prisma.user.findUnique({ where: { email } })
        if (existingUser) throw new Error("USER_ALREADY_EXISTS")

        const hashedPassword = await bcrypt.hash(password, 10)

        // 4. Username Logic
        let finalUsername = username
        if (finalUsername) {
            const conflict = await prisma.user.findFirst({ where: { username: { equals: finalUsername as string, mode: 'insensitive' } } })
            if (conflict) throw new Error("USERNAME_IN_USE")
        } else if (targetCompanyId) {
            finalUsername = await generateUsername(targetCompanyId)
        }

        // 5. Database Transaction
        const user = await prisma.user.create({
            data: {
                firstName, lastName, email, username: finalUsername!, password: hashedPassword,
                role: newUserRole, status: 'OFFLINE', gender: gender || 'MALE', companyId: targetCompanyId,
                salary: salary || 0,
                dayOffCredit: baseDayOffCredit !== undefined ? baseDayOffCredit : (dayOffCredit !== undefined ? dayOffCredit : 0),
                baseDayOffCredit: baseDayOffCredit !== undefined ? baseDayOffCredit : (dayOffCredit !== undefined ? dayOffCredit : 0),
                // F-14: the year this credit balance was actually granted,
                // not a hardcoded year that goes stale for accounts created later.
                lastDayOffResetYear: getEgyptNow().getFullYear()
            },
            select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true, gender: true, username: true }
        })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('CREATE_USER', 'USER', user.id, {
            userId: userRole !== 'SUPER_ADMIN' ? session.user.id : null,
            superAdminId: userRole === 'SUPER_ADMIN' ? session.user.id : null,
            details: { email: email, role: newUserRole, companyId: targetCompanyId }
        })

        return user
    }

    static async update(input: UpdateUserInput, session: any) {
        const userRole = session.user.role
        const { id, firstName, lastName, email, password, role, gender, salary, companyId, avatar, dayOffCredit, baseDayOffCredit, username, status } = input

        const regularUser = await prisma.user.findUnique({ where: { id } })
        const superAdminUser = !regularUser ? await prisma.superAdmin.findUnique({ where: { id } }) : null

        if (!regularUser && !superAdminUser) throw new Error("USER_NOT_FOUND")

        // Security: Company Isolation
        if (userRole !== 'SUPER_ADMIN' && regularUser) {
            const requesterCompanyId = (session.user as any).companyId
            if (regularUser.companyId !== requesterCompanyId) {
                throw new Error("CROSS_COMPANY_ACCESS_FORBIDDEN")
            }
        }

        const updateData: any = {}
        const isSelf = id === session.user.id

        // 1. Name Change Restrictions
        if (isSelf && regularUser && ['EMPLOYEE', 'TEAM_LEADER'].includes(regularUser.role)) {
            if ((firstName && firstName !== regularUser.firstName) || (lastName && lastName !== regularUser.lastName)) {
                throw new Error("NAME_CHANGE_REQUIRES_ADMIN")
            }
        }

        // 2. Basic Data
        if (firstName) updateData.firstName = firstName
        if (lastName) updateData.lastName = lastName
        if (email) updateData.email = email
        if (password) {
            // WAVE 10: Security Gate for Admin Password Resets
            const targetRole = regularUser?.role || 'SUPER_ADMIN'
            if (['ADMIN', 'SUPER_ADMIN'].includes(targetRole) && !isSelf && userRole === 'SUPER_ADMIN') {
                const { passcode } = input
                if (!VerificationService.isValid(passcode || "")) {
                    throw new Error("INVALID_PASSCODE")
                }
            }

            updateData.password = await bcrypt.hash(password, 10)
            // Any password change — self-service or admin-forced — satisfies
            // a pending forced reset.
            updateData.mustChangePassword = false
        }
        if (gender) updateData.gender = gender

        // 3. Avatar Management
        if (avatar !== undefined) {
            updateData.avatar = avatar
            const oldAvatar = regularUser?.avatar || superAdminUser?.avatar
            if (oldAvatar && oldAvatar !== avatar) {
                try {
                    const parts = oldAvatar.split('/app-assets/')
                    if (parts.length > 1) await supabase.storage.from('app-assets').remove([parts[1]])
                } catch (e) { console.error('[USER_AVATAR_DELETE_FAIL]', e) }
            }
        }

        // 4. Role & Privileged Fields
        if (regularUser) {
            if (role && ['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
                if ((role === 'ADMIN' || role === 'SUPER_ADMIN') && userRole !== 'SUPER_ADMIN') {
                    throw new Error("FORBIDDEN_ROLE_ASSIGNMENT")
                }
                updateData.role = role
            }

            if (username !== undefined && userRole === 'SUPER_ADMIN') updateData.username = username || null

            if (['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) {
                if (salary !== undefined) updateData.salary = salary
                if (dayOffCredit !== undefined) updateData.dayOffCredit = dayOffCredit
                if (baseDayOffCredit !== undefined) {
                    updateData.baseDayOffCredit = baseDayOffCredit
                    const currentYear = new Date().getFullYear()
                    const deductions = await prisma.dayOffRequest.aggregate({
                        where: { userId: id, status: 'APPROVED', deductionType: 'CREDIT', date: { gte: new Date(currentYear, 0, 1), lt: new Date(currentYear + 1, 0, 1) } },
                        _sum: { daysDeducted: true }
                    })
                    updateData.dayOffCredit = baseDayOffCredit - (deductions._sum.daysDeducted || 0)
                }
            }

            if (companyId !== undefined && userRole === 'SUPER_ADMIN') updateData.companyId = companyId || null
            if (status !== undefined && ['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) updateData.status = status

            const updated = await prisma.user.update({
                where: { id }, data: updateData,
                select: { id: true, firstName: true, lastName: true, email: true, role: true, gender: true, salary: true, companyId: true, avatar: true, dayOffCredit: true, baseDayOffCredit: true, username: true }
            })
            // salary is a Prisma.Decimal (F-07); Decimal.toJSON() returns a
            // string, which would silently change this response field's type.
            const serializedUpdated = { ...updated, salary: Number(updated.salary) }

            // Salary record sync
            if (updateData.salary !== undefined) {
                const now = new Date()
                const m = now.getMonth() + 1, y = now.getFullYear()
                const { SalaryService } = await import("./salary.service")
                await SalaryService.ensureRecordExists(id, m, y, updateData.salary)
            }


            // Audit Log (Enhanced Diffs)
            // normalize() handles `salary`: it's a Prisma.Decimal on the fetched
            // regularUser but a plain number on updateData, so comparing them
            // with !== directly always differs even when the value is unchanged
            // (different types), which would log a spurious "salary changed" on
            // every edit that merely touches an unrelated field.
            const normalize = (v: any) => (v && typeof v === 'object' && typeof v.toNumber === 'function') ? v.toNumber() : v
            const diffs: any = {}
            for (const key in updateData) {
                if (key === 'password' || key === 'mustChangePassword') continue
                const oldVal = normalize(regularUser[key as keyof typeof regularUser])
                const newVal = normalize(updateData[key])
                if (newVal !== oldVal) {
                    diffs[key] = { old: oldVal, new: newVal }
                }
            }

            if (Object.keys(diffs).length > 0) {
                const { AuditLogService } = await import("./audit-log.service")
                await AuditLogService.log('UPDATE_USER', 'USER', id, {
                    userId: userRole !== 'SUPER_ADMIN' ? session.user.id : null,
                    superAdminId: userRole === 'SUPER_ADMIN' ? session.user.id : null,
                    details: diffs
                })
            }

            return serializedUpdated
        }

        if (superAdminUser) {
            const updated = await prisma.superAdmin.update({
                where: { id },
                data: updateData,
                select: { id: true, firstName: true, lastName: true, email: true, gender: true, avatar: true, username: true }
            })
            return { ...updated, role: 'SUPER_ADMIN', status: 'ACTIVE', salary: 0 }
        }
    }

    static async updateLanguage(userId: string, language: string) {
        return await prisma.user.update({
            where: { id: userId },
            data: { language },
            select: { id: true, language: true }
        })
    }

    static async updateActivity(userId: string, role: string) {
        if (role === 'SUPER_ADMIN') {
            return { success: true, status: 'ACTIVE' }
        }

        const user = await prisma.user.update({
            where: { id: userId },
            data: { lastActivity: new Date() },
            select: {
                status: true,
                company: { select: { isBanned: true } }
            }
        })

        if (user.status === 'SUSPENDED') return { success: true, status: 'SUSPENDED' }
        if (user.company?.isBanned) return { success: true, status: 'COMPANY_BANNED' }

        return { success: true, status: 'ACTIVE' }
    }

    static async updateStatus(userId: string, status: string, session: any) {
        const requesterRole = session.user.role
        if (requesterRole !== 'SUPER_ADMIN') {
            throw new Error("FORBIDDEN")
        }

        if (!['ACTIVE', 'OFFLINE', 'SUSPENDED'].includes(status)) {
            throw new Error("INVALID_STATUS")
        }

        const existingUser = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } })
        if (!existingUser) throw new Error("USER_NOT_FOUND")

        const updated = await prisma.user.update({
            where: { id: userId },
            data: { status },
            select: { id: true, status: true }
        })

        // Audit Log (Centralized)
        if (existingUser.status !== status) {
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('UPDATE_USER_STATUS', 'USER', userId, {
                superAdminId: session.user.id,
                details: { status: { old: existingUser.status, new: status } }
            })
        }

        return updated
    }

    static async resetPoints(userId: string, session: any) {
        const requesterRole = session.user.role
        if (!['ADMIN', 'SUPER_ADMIN'].includes(requesterRole)) {
            throw new Error("FORBIDDEN")
        }

        const existingUser = await prisma.user.findUnique({ where: { id: userId }, select: { totalDifficultyPoints: true } })
        if (!existingUser) throw new Error("USER_NOT_FOUND")

        const updated = await prisma.user.update({
            where: { id: userId },
            data: { totalDifficultyPoints: 0 },
            select: { id: true, totalDifficultyPoints: true }
        })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('RESET_USER_POINTS', 'USER', userId, {
            userId: requesterRole !== 'SUPER_ADMIN' ? session.user.id : null,
            superAdminId: requesterRole === 'SUPER_ADMIN' ? session.user.id : null,
            details: { points: { old: existingUser.totalDifficultyPoints, new: 0 } }
        })

        return updated
    }

    static async resetAllPoints(companyId: string, passcode: string, session: any) {
        if (!VerificationService.isValid(passcode)) throw new Error("INVALID_PASSCODE")
        if (session.user.role !== 'SUPER_ADMIN') throw new Error("FORBIDDEN")

        const result = await prisma.user.updateMany({
            where: { companyId, status: { not: 'DELETED' } },
            data: { totalDifficultyPoints: 0 }
        })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('RESET_ALL_POINTS', 'COMPANY', companyId, {
            superAdminId: session.user.id,
            details: { count: result.count, action: 'Bulk Reset Points' }
        })

        return result
    }

    static async getDayOffHistory(userId: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { dayOffCredit: true, baseDayOffCredit: true }
        })

        if (!user) throw new Error("USER_NOT_FOUND")

        const [requests, snapshots] = await Promise.all([
            prisma.dayOffRequest.findMany({
                where: { userId, status: 'APPROVED' },
                orderBy: { date: 'desc' }
            }),
            prisma.dayOffCreditSnapshot.findMany({
                where: { userId },
                orderBy: { year: 'desc' }
            })
        ])

        const years = Array.from(new Set([
            ...requests.map(r => new Date(r.date).getFullYear()),
            ...snapshots.map(s => s.year)
        ])).sort((a, b) => b - a)

        const historyByYear = years.map(year => ({
            year,
            snapshot: snapshots.find(s => s.year === year) || null,
            requests: requests.filter(r => new Date(r.date).getFullYear() === year)
        }))

        return {
            baseCredit: user.baseDayOffCredit,
            remainingCredit: user.dayOffCredit,
            history: historyByYear
        }
    }

    static async getCostsHistory(userId: string) {
        // Fetch all tasks where this user is an assignee and has a paid cost
        const tasks = await prisma.task.findMany({
            where: {
                assignees: { some: { id: userId } },
                paymentStatus: { in: ['PAID', 'PENDING_PAYMENT'] }
            },
            orderBy: { updatedAt: 'desc' },
            select: {
                id: true,
                title: true,
                updatedAt: true,
                memberCosts: true,
                memberPaymentStatus: true
            }
        })

        return tasks
            .map(task => {
                const memberCosts = (task.memberCosts as any) || {}
                const memberPaymentStatus = (task.memberPaymentStatus as any) || {}
                const cost = memberCosts[userId]
                const status = memberPaymentStatus[userId]

                if (cost !== undefined && cost !== null) {
                    return {
                        id: task.id,
                        title: task.title,
                        amount: cost,
                        status: status || 'PENDING_PAYMENT',
                        date: task.updatedAt
                    }
                }
                return null
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)
    }

    static async verifyPassword(userId: string, password: string) {
        // 1. Try finding in regular User table
        const user = await prisma.user.findUnique({ where: { id: userId } })
        if (user) {
            const isValid = await bcrypt.compare(password, user.password)
            return { valid: isValid }
        }

        // 2. Try SuperAdmin table
        const superAdmin = await prisma.superAdmin.findUnique({ where: { id: userId } })
        if (superAdmin) {
            const isValid = await bcrypt.compare(password, superAdmin.password)
            return { valid: isValid }
        }

        throw new Error("USER_NOT_FOUND")
    }

    /**
     * Replaces the old "reveal password" feature (F-02): rather than
     * decrypting a user's actual password, an admin generates a fresh
     * one-time temporary password. The target must change it at next login
     * (see `mustChangePassword`). Scoped to regular User accounts only —
     * resetting a SuperAdmin's own credentials is out of scope here; see
     * the MFA/reset-flow enhancement (F-27) for that.
     */
    static async resetPassword(targetUserId: string, actingUser: { id: string; role: string }, confirmPassword: string) {
        // 1. Verify the acting admin's own password before letting them
        // reset someone else's — the acting user may be a SuperAdmin or a
        // company ADMIN, so check whichever table they actually live in.
        const actingAccount = actingUser.role === 'SUPER_ADMIN'
            ? await prisma.superAdmin.findUnique({ where: { id: actingUser.id } })
            : await prisma.user.findUnique({ where: { id: actingUser.id } })

        if (!actingAccount) throw new Error("ADMIN_NOT_FOUND")

        const isPasswordValid = await bcrypt.compare(confirmPassword, actingAccount.password)
        if (!isPasswordValid) throw new Error("INVALID_ADMIN_PASSWORD")

        // 2. Locate the target
        const target = await prisma.user.findUnique({ where: { id: targetUserId } })
        if (!target) throw new Error("TARGET_USER_NOT_FOUND")

        // 3. Generate, hash, and store — the plaintext is returned once and never persisted.
        const tempPassword = generateTempPassword()
        const hashedPassword = await bcrypt.hash(tempPassword, 10)

        await prisma.user.update({
            where: { id: targetUserId },
            data: { password: hashedPassword, mustChangePassword: true }
        })

        return { targetUserId, password: tempPassword }
    }

    static async delete(id: string, session: any, isPermanent = false, passcode?: string) {
        if (isPermanent && !VerificationService.isValid(passcode || "")) {
            throw new Error("INVALID_PASSCODE")
        }
        const requesterRole = session.user.role
        const currentUserId = session.user.id

        if (!id || id === currentUserId) throw new Error("INVALID_ID")

        const user = await prisma.user.findUnique({ where: { id } })
        if (!user) throw new Error("USER_NOT_FOUND")

        // Security: Company Isolation
        if (requesterRole !== 'SUPER_ADMIN') {
            const requesterCompanyId = session.user.companyId
            if (user.companyId !== requesterCompanyId) {
                throw new Error("CROSS_COMPANY_ACCESS_FORBIDDEN")
            }
        }

        if (user.role === 'ADMIN' && requesterRole !== 'SUPER_ADMIN') throw new Error("FORBIDDEN")
        if (user.role === 'SUPER_ADMIN') throw new Error("FORBIDDEN")

        let result: any
        if (isPermanent) {
            if (user.status !== 'DELETED') throw new Error("MUST_SOFT_DELETE_FIRST")

            // Avatar Cleanup (Strict)
            if (user.avatar) {
                try {
                    const parts = user.avatar.split('/app-assets/')
                    if (parts.length > 1) await supabase.storage.from('app-assets').remove([parts[1]])
                } catch (e) { console.error('[USER_DELETE_AVATAR_FAIL]', e) }
            }

            result = await prisma.user.delete({ where: { id } })
        } else {
            // Soft Delete: We also cleanup avatar
            if (user.avatar) {
                try {
                    const parts = user.avatar.split('/app-assets/')
                    if (parts.length > 1) await supabase.storage.from('app-assets').remove([parts[1]])
                } catch (e) { console.error('[USER_SOFT_DELETE_AVATAR_FAIL]', e) }
            }

            result = await prisma.user.update({
                where: { id },
                data: {
                    status: 'DELETED',
                    email: `${user.email}_DELETED_${Date.now()}`,
                    firstName: 'Ghost',
                    lastName: 'User',
                    username: `deleted_${Date.now()}`,
                    avatar: null
                }
            })
        }

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('DELETE_USER', 'USER', id, {
            userId: requesterRole !== 'SUPER_ADMIN' ? currentUserId : null,
            superAdminId: requesterRole === 'SUPER_ADMIN' ? currentUserId : null,
            details: { isPermanent }
        })

        return result
    }
}
