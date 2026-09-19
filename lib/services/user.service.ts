import { prisma } from "@/lib/prisma"
import { UserStatus } from "@prisma/client"
import { VerificationService } from "./verification.service"
import { supabase } from "@/lib/storage"
import bcrypt from "bcryptjs"
import { generateUsername } from "@/lib/username"
import { generateTempPassword } from "@/lib/generate-password"

import { CreateUserInput, UpdateUserInput } from "../validations/user.schema"
import { calendarMonth, calendarYear } from "@/lib/time"
import { effectiveFromChoice } from "@/lib/salary-history"

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
        //
        // The user row, the hiring event and the opening salary go in together,
        // because payroll reads the last two and not the first.
        //
        // Writing only the row is what shipped, and it made the intended
        // onboarding flow — Employees, Add Employee, set a salary — produce
        // somebody the register could never pay. A person's employed span only
        // opens on a HIRED or REINSTATED event (lib/employment.ts), and
        // eventForStatusChange has no transition that yields HIRED: it maps
        // status changes, and being created is not one. So compute() skipped
        // them on `timeline.employed.length === 0` forever. The only way
        // through was to archive the person and reinstate them, which is to say
        // fire and rehire somebody to hire them.
        //
        // User.salary is the same story one level down. It is the current rate,
        // a cache of the history; SalaryChange is what splitMonth actually
        // reads. A user row carrying 3000 with no SalaryChange resolves to "No
        // salary in effect" for every month there is.
        //
        // Dated at the moment of creation rather than the start of the month:
        // the employed span and the rate then begin at the same instant, and
        // nobody is paid for days before they existed. An employee who really
        // started earlier needs a back-dated salary change, which the history
        // screen already does.
        const hiredAt = new Date()

        // A Super Admin has no company and draws no salary — the payroll
        // module is about a company's own people.
        const isCompanyEmployee = Boolean(targetCompanyId) && newUserRole !== 'SUPER_ADMIN'

        const user = await prisma.$transaction(async (tx) => {
            const created = await tx.user.create({
                data: {
                    firstName, lastName, email, username: finalUsername!, password: hashedPassword,
                    role: newUserRole, status: 'OFFLINE', gender: gender || 'MALE', companyId: targetCompanyId,
                    salary: salary || 0,
                    dayOffCredit: baseDayOffCredit !== undefined ? baseDayOffCredit : (dayOffCredit !== undefined ? dayOffCredit : 0),
                    baseDayOffCredit: baseDayOffCredit !== undefined ? baseDayOffCredit : (dayOffCredit !== undefined ? dayOffCredit : 0),
                    // F-14: the year this credit balance was actually granted,
                    // not a hardcoded year that goes stale for accounts created later.
                    lastDayOffResetYear: calendarYear(new Date())
                },
                select: { id: true, firstName: true, lastName: true, email: true, role: true, status: true, gender: true, username: true }
            })

            if (isCompanyEmployee) {
                const { EmploymentService } = await import("./employment.service")
                await EmploymentService.record({
                    userId: created.id,
                    type: 'HIRED',
                    effectiveFrom: hiredAt,
                    reason: 'Account created',
                    createdById: session?.user?.id ?? null,
                }, tx)

                const { SalaryHistoryService } = await import("./salary-history.service")
                await SalaryHistoryService.record({
                    userId: created.id,
                    monthlyAmount: Number(salary || 0),
                    effectiveFrom: hiredAt,
                    reason: 'Starting salary',
                    createdById: session?.user?.id ?? null,
                }, tx)
            }

            return created
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
        if (email) {
            const currentEmail = regularUser?.email ?? superAdminUser?.email
            if (email !== currentEmail) {
                // F-27: email changes go through the verified flow
                // (VerificationCodeService + /api/account/email) instead —
                // applying one here would mean nothing ever confirmed the
                // new address is actually reachable. Only blocks *self*;
                // an admin correcting a different user's email is
                // unaffected. A protected SuperAdmin's email can't change
                // at all, self-edit or not — the frontend already disables
                // this field for self-edit (EmployeeProfileForm), this is
                // the backend half of that, since a disabled input is not
                // an authorization check.
                if (isSelf) throw new Error("EMAIL_CHANGE_REQUIRES_VERIFICATION")
                if (superAdminUser?.isProtected) throw new Error("TARGET_PROTECTED")
                updateData.email = email
            }
        }
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
                // Deliberately not written here. A salary change is an
                // effective-dated fact, not a field edit: it has to land in
                // SalaryChange as well, and the two have to move together or a
                // payslip computed from history will disagree with the number
                // an admin is looking at. SalaryHistoryService.record does both
                // in one transaction, and is called below once the rest of the
                // update has succeeded.
                if (salary !== undefined) updateData.salary = salary
                if (dayOffCredit !== undefined) updateData.dayOffCredit = dayOffCredit
                if (baseDayOffCredit !== undefined) {
                    updateData.baseDayOffCredit = baseDayOffCredit
                    const currentYear = calendarYear(new Date())
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

            // Salary history and record sync.
            //
            // Only when the value actually moved. The old code ran on every
            // update that mentioned salary, so saving a user's name with the
            // salary field untouched still wrote a change — which would now
            // mean a SalaryChange row saying the salary changed to what it
            // already was, in a history whose whole purpose is to be read back.
            const previousSalary = regularUser ? Number(regularUser.salary) : null
            const salaryMoved = updateData.salary !== undefined
                && previousSalary !== null
                && Number(updateData.salary) !== previousSalary

            // The employment timeline, on the same reasoning as the salary
            // history above: a suspension entered through this screen has to
            // leave a trace, or a payslip pays the suspended month in full
            // because nothing said otherwise. Only real employment transitions
            // produce an event — ACTIVE to OFFLINE is presence, not a contract.
            if (updateData.status !== undefined && updateData.status !== regularUser.status) {
                const { EmploymentService } = await import("./employment.service")
                await EmploymentService.recordStatusChange({
                    userId: id,
                    previousStatus: regularUser.status,
                    newStatus: updateData.status,
                    createdById: session?.user?.id ?? null,
                })
            }

            if (salaryMoved) {
                const now = new Date()
                const { SalaryHistoryService } = await import("./salary-history.service")
                await SalaryHistoryService.record({
                    userId: id,
                    monthlyAmount: Number(updateData.salary),
                    // Effective from the start of the current month unless the
                    // caller says otherwise. P7's screen will offer the
                    // this-month-or-next choice; until it does, the safe default
                    // is the behaviour that already existed — the new salary
                    // applies to the month being worked.
                    effectiveFrom: effectiveFromChoice(now, input.salaryEffective ?? 'THIS_MONTH'),
                    reason: input.salaryReason,
                    createdById: session?.user?.id ?? null,
                })

                const { month: m, year: y } = calendarMonth(now)
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

        const [user, settings] = await Promise.all([
            prisma.user.update({
                where: { id: userId },
                data: { lastActivity: new Date() },
                select: {
                    status: true,
                    company: { select: { isBanned: true } }
                }
            }),
            // Live read, not the throttled session copy — this is the
            // heartbeat's whole job: catching a state change within its own
            // 2-minute poll interval rather than waiting on the JWT's 60s
            // staleness window on top of that.
            prisma.systemSettings.findUnique({ where: { id: 'default' }, select: { maintenanceMode: true, maintenanceMessage: true } })
        ])

        if (user.status === 'SUSPENDED') return { success: true, status: 'SUSPENDED' }
        // Reported under its own name, not folded into SUSPENDED. The browser
        // is signed out either way, but the screen it shows on the way out
        // names the reason, and this is not a suspension.
        if (user.status === 'ARCHIVED') return { success: true, status: 'ARCHIVED' }
        if (user.company?.isBanned) return { success: true, status: 'COMPANY_BANNED' }
        if (settings?.maintenanceMode) return { success: true, status: 'MAINTENANCE', maintenanceMessage: settings.maintenanceMessage }

        return { success: true, status: 'ACTIVE' }
    }

    static async updateStatus(userId: string, status: string, session: any) {
        const requesterRole = session.user.role
        if (requesterRole !== 'SUPER_ADMIN') {
            throw new Error("FORBIDDEN")
        }

        const allowedStatuses: UserStatus[] = ['ACTIVE', 'OFFLINE', 'SUSPENDED']
        if (!allowedStatuses.includes(status as UserStatus)) {
            throw new Error("INVALID_STATUS")
        }

        const existingUser = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } })
        if (!existingUser) throw new Error("USER_NOT_FOUND")

        const updated = await prisma.user.update({
            where: { id: userId },
            data: { status: status as UserStatus },
            select: { id: true, status: true }
        })

        // Same bridge as UserService.update's. This is the Super Admin path to
        // the same field, and a timeline that records one route but not the
        // other is worse than one that records neither: the gap is invisible,
        // and which route an admin happened to use is not written down anywhere.
        const { EmploymentService } = await import("./employment.service")
        await EmploymentService.recordStatusChange({
            userId,
            previousStatus: existingUser.status,
            newStatus: status,
            createdById: session?.user?.id ?? null,
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

        // Grouped on the same clock the snapshots were keyed on.
        // DayOffCreditSnapshot.year comes from lastDayOffResetYear, which is a
        // calendar year; reading the request's year off the server's clock
        // instead would put a request made late on 31 December under the wrong
        // snapshot — a leave day appearing in a year whose balance never
        // counted it.
        const yearOf = (r: { date: Date }) => calendarYear(new Date(r.date))

        const years = Array.from(new Set([
            ...requests.map(yearOf),
            ...snapshots.map(s => s.year)
        ])).sort((a, b) => b - a)

        const historyByYear = years.map(year => ({
            year,
            snapshot: snapshots.find(s => s.year === year) || null,
            requests: requests.filter(r => yearOf(r) === year)
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
