import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { NotificationService } from "./notification.service"
import { computePeriodStart, computePeriodEnd, isSubscriptionType, daysUntil } from "@/lib/billing/period"
import { decideReminder, REMINDER_RUNGS } from "@/lib/billing/reminders"
import { VerificationService } from "./verification.service"
import { CreateCompanyInput, UpdateCompanyInput } from "../validations/company.schema"

// cost is a Prisma.Decimal (F-07); Decimal.toJSON() returns a string, which
// would silently change this response field's type on the wire.
function serializeCompanyPayment<T extends { cost: Prisma.Decimal }>(payment: T) {
    return { ...payment, cost: Number(payment.cost) }
}

export class CompanyService {
    static async create(input: CreateCompanyInput, session: any) {
        const company = await prisma.company.create({
            data: { name: input.name }
        })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('CREATE_COMPANY', 'COMPANY', company.id, {
            superAdminId: session.user.id,
            details: { name: input.name }
        })

        return company
    }

    static async update(input: UpdateCompanyInput, session: any) {
        const { id, name, isBanned, autoVerifyLocation, vendorsLabel } = input
        // Empty string means "reset to the default label", stored as null
        // same as never having set one — not as a literal empty string.
        const normalizedVendorsLabel = vendorsLabel === '' ? null : vendorsLabel

        const existing = await prisma.company.findUnique({ where: { id } })
        if (!existing) throw new Error("COMPANY_NOT_FOUND")

        // Protection for SHSD
        if (existing.name === 'SHSD' && name && name !== 'SHSD') {
            throw new Error("CANNOT_RENAME_SHSD")
        }

        const updated = await prisma.company.update({
            where: { id },
            data: {
                ...(name && { name }),
                ...(isBanned !== undefined && { isBanned }),
                ...(autoVerifyLocation !== undefined && { autoVerifyLocation }),
                ...(vendorsLabel !== undefined && { vendorsLabel: normalizedVendorsLabel })
            }
        })

        // Audit Log (Centralized)
        const changes: any = {}
        if (name && name !== existing.name) changes.name = { old: existing.name, new: name }
        if (isBanned !== undefined && isBanned !== existing.isBanned) changes.isBanned = { old: existing.isBanned, new: isBanned }
        if (autoVerifyLocation !== undefined && autoVerifyLocation !== existing.autoVerifyLocation) {
            changes.autoVerifyLocation = { old: existing.autoVerifyLocation, new: autoVerifyLocation }
        }
        if (vendorsLabel !== undefined && normalizedVendorsLabel !== existing.vendorsLabel) {
            changes.vendorsLabel = { old: existing.vendorsLabel, new: normalizedVendorsLabel }
        }

        if (Object.keys(changes).length > 0) {
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('UPDATE_COMPANY', 'COMPANY', id, {
                superAdminId: session.user.id,
                details: changes
            })
        }

        return updated
    }

    static async delete(id: string, passcode: string, session: any) {
        if (!VerificationService.isValid(passcode)) {
            throw new Error("INVALID_PASSCODE")
        }
        const company = await prisma.company.findUnique({
            where: { id },
            include: {
                users: { select: { id: true } },
                businessClients: { select: { id: true } }
            }
        })

        if (!company) throw new Error("COMPANY_NOT_FOUND")
        if (company.name === 'SHSD') throw new Error("CANNOT_DELETE_SHSD")

        return await prisma.$transaction(async (tx) => {
            // Prisma cascades (onDelete: Cascade) in schema.prisma will handle:
            // - Tasks, Obligations, Requests, Payments
            // - Users and their personal data (Notifications, Salary, etc.)
            // - Clients, Sections, and Notes

            const deleted = await tx.company.delete({ where: { id } })

            // Audit Log (Centralized)
            const { AuditLogService } = await import("./audit-log.service")
            await AuditLogService.log('DELETE_COMPANY', 'COMPANY', id, {
                tx,
                superAdminId: session.user.id,
                details: { name: company.name }
            })

            return deleted
        })
    }

    /**
     * Fetch all payments for a company.
     */
    static async getPayments(companyId: string) {
        const payments = await prisma.companyPayment.findMany({
            where: { companyId },
            orderBy: { createdAt: 'desc' },
            include: { company: { select: { name: true } } }
        })
        return payments.map(serializeCompanyPayment)
    }

    /**
     * Create a new unpaid payment record for a company.
     */
    static async createPayment(companyId: string, cost: number, subscriptionType: string, session: any) {
        const payment = await prisma.companyPayment.create({
            data: {
                companyId,
                cost,
                subscriptionType,
                status: 'UNPAID'
            }
        })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('CREATE_COMPANY_PAYMENT', 'COMPANY_PAYMENT', payment.id, {
            superAdminId: session.user.id,
            details: { companyId, cost, subscriptionType }
        })

        return serializeCompanyPayment(payment)
    }

    /**
     * Mark a payment as PAID and compute the period it buys.
     *
     * Two rules live here, both of which used to be wrong:
     *
     * 1. A renewal continues from the end of the period already paid for, not
     *    from today. Paying a week early previously threw that week away.
     * 2. A "month" is a calendar month. It used to be 30 days while a year was a
     *    calendar year, so twelve monthly payments bought 360 days — the
     *    customer lost five days a year and nobody would ever have noticed.
     *
     * Neither is retroactive: endDate is written once, here, so rows confirmed
     * before this change keep the dates they were given.
     */
    static async updatePaymentStatus(paymentId: string, status: string, session: any) {
        if (status !== 'PAID') throw new Error("ONLY_PAID_SUPPORTED")

        const payment = await prisma.companyPayment.findUnique({ where: { id: paymentId } })
        if (!payment) throw new Error("PAYMENT_NOT_FOUND")
        if (!isSubscriptionType(payment.subscriptionType)) throw new Error("UNKNOWN_SUBSCRIPTION_TYPE")

        const now = new Date()

        // The furthest-out period this company already holds. A row with a null
        // endDate is a lifetime subscription, and `orderBy endDate desc` sorts
        // nulls first in Postgres — so it is found by this query, and
        // computePeriodStart reads it as "nothing to extend".
        const currentPeriod = await prisma.companyPayment.findFirst({
            where: { companyId: payment.companyId, status: 'PAID', id: { not: paymentId } },
            orderBy: { endDate: 'desc' },
            select: { endDate: true }
        })

        const startDate = computePeriodStart(now, currentPeriod?.endDate)
        const endDate = computePeriodEnd(startDate, payment.subscriptionType)

        const updated = await prisma.companyPayment.update({
            where: { id: paymentId },
            data: {
                status: 'PAID',
                paidAt: now,
                startDate,
                endDate,
                // A new period gets its reminders back. Any endDate write must
                // do this, or the ladder stays spent and the period expires in
                // silence — the exact failure the old boolean had.
                remindersSent: []
            }
        })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('CONFIRM_COMPANY_PAYMENT', 'COMPANY_PAYMENT', paymentId, {
            superAdminId: session.user.id,
            details: { companyId: payment.companyId, cost: Number(payment.cost), endDate }
        })

        return serializeCompanyPayment(updated)
    }

    /**
     * Delete an UNPAID payment record.
     */
    static async deletePayment(paymentId: string, session: any) {
        const payment = await prisma.companyPayment.findUnique({ where: { id: paymentId } })
        if (!payment) throw new Error("PAYMENT_NOT_FOUND")
        if (payment.status === 'PAID') throw new Error("CANNOT_DELETE_PAID")

        const deleted = await prisma.companyPayment.delete({ where: { id: paymentId } })

        // Audit Log (Centralized)
        const { AuditLogService } = await import("./audit-log.service")
        await AuditLogService.log('DELETE_COMPANY_PAYMENT', 'COMPANY_PAYMENT', paymentId, {
            superAdminId: session.user.id,
            details: { companyId: payment.companyId, cost: Number(payment.cost) }
        })

        return serializeCompanyPayment(deleted)
    }

    /**
     * Daily expiry reminders: the 14 / 3 / 1 ladder.
     *
     * Which rung a subscription is due for is decided by `decideReminder`, a
     * pure function — this method only gathers recipients and writes. The rungs
     * already spent live in `remindersSent`, replacing a single boolean that
     * could say something had been sent but not which, so it could never drive
     * more than one reminder and never survived an extension.
     *
     * Reminders now reach the company's own Admins as well as the platform's
     * Super Admins. Telling only the vendor is survivable while renewals are
     * chased by hand; once grace and lockout are automatic it is a trap, because
     * the customer's first warning would be the screen going red.
     */
    static async checkSubscriptions() {
        const now = new Date()
        const widestRung = Math.max(...REMINDER_RUNGS)
        const windowEnd = new Date(now.getTime() + widestRung * 24 * 60 * 60 * 1000)

        // Candidates: paid periods ending inside the widest rung's window that
        // have not spent every rung. A null endDate is a lifetime subscription
        // and is excluded by `gt: now` — it has no expiry to warn about, and
        // this is one of the places where treating null as a date would have
        // read as "expired in 1970".
        const expiringPayments = await prisma.companyPayment.findMany({
            where: {
                status: 'PAID',
                endDate: { gt: now, lte: windowEnd }
            },
            include: { company: { select: { id: true, name: true } } }
        })

        if (expiringPayments.length === 0) {
            return { message: "No expiring subscriptions found", count: 0 }
        }

        // Super Admin recipients. The two sources are kept apart, not merged
        // into one id list: they come from different tables with independent
        // UUID spaces, and Notification addresses each through its own FK
        // column. Flattening them is precisely what used to break this job —
        // every SuperAdmin-table id was written to Notification.userId, which is
        // FK-constrained to User, so the insert threw and no expiry notification
        // was ever delivered.
        const [adminsFromTable, adminsFromUserRole] = await Promise.all([
            prisma.superAdmin.findMany({ select: { id: true } }),
            prisma.user.findMany({
                where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
                select: { id: true }
            })
        ])

        const superAdminIds = adminsFromTable.map(a => a.id)
        const platformUserIds = adminsFromUserRole.map(a => a.id)

        // The customer's own Admins, fetched per company rather than globally:
        // a billing message naming a company must never reach another company's
        // Admin, and this codebase has shipped cross-tenant leaks before.
        const companyIds = Array.from(new Set(expiringPayments.map(p => p.company.id)))
        const companyAdmins = await prisma.user.findMany({
            where: { companyId: { in: companyIds }, role: 'ADMIN', status: 'ACTIVE' },
            select: { id: true, companyId: true }
        })
        const adminsByCompany = new Map<string, string[]>()
        for (const admin of companyAdmins) {
            if (!admin.companyId) continue
            const list = adminsByCompany.get(admin.companyId) ?? []
            list.push(admin.id)
            adminsByCompany.set(admin.companyId, list)
        }

        let notificationsCreated = 0
        let remindersSent = 0

        for (const payment of expiringPayments) {
            const daysLeft = daysUntil(payment.endDate, now)
            if (daysLeft === null) continue

            const decision = decideReminder(daysLeft, payment.remindersSent)

            // Nothing due, but rungs may still need recording — a first sighting
            // mid-period spends the rungs whose moment predates it, so they can
            // never fire late as a backlog.
            if (decision.send === null) {
                if (decision.markSent.length > 0) {
                    await prisma.companyPayment.update({
                        where: { id: payment.id },
                        data: { remindersSent: { push: decision.markSent } }
                    })
                }
                continue
            }

            const endsOn = payment.endDate!.toLocaleDateString()
            const operatorMessage = `Subscription for ${payment.company.name} will expire in ${decision.send} day(s) (${endsOn}).`
            const customerMessage = `Your subscription expires in ${decision.send} day(s) (${endsOn}). Please renew to avoid interruption.`

            // relatedId carries a dashboard path rather than the payment id. The
            // bell has to reach that company's billing page, which needs the
            // companyId, and a notification row has only one related-id column.
            // This is the same convention the NOTE type already uses, and
            // NotificationBell dispatches on the leading slash.
            const operatorTarget = `/dashboard/companies/${payment.company.id}/payments`
            const customerAdminIds = adminsByCompany.get(payment.company.id) ?? []

            // With nobody to tell, the rung is not spent. Recording it would burn
            // the reminder against a delivery that never happened, and the next
            // run — by which time a Super Admin may exist — would stay silent.
            if (superAdminIds.length + platformUserIds.length + customerAdminIds.length === 0) {
                continue
            }

            // One transaction per payment covering both the inserts and the rung
            // record: previously the flag was written outside any transaction and
            // after the inserts, so a failure partway through left recipients
            // notified with nothing recorded, and the next run notified them again.
            await prisma.$transaction(async (tx) => {
                await NotificationService.notifySuperAdmins(superAdminIds, 'SUBSCRIPTION_EXPIRY', operatorMessage, operatorTarget, tx)
                await NotificationService.notifyMany(platformUserIds, 'SUBSCRIPTION_EXPIRY', operatorMessage, operatorTarget, tx)
                // No link for the customer: the billing page is Super Admin only,
                // and a notification that navigates to a 403 is worse than one
                // that does not navigate at all.
                await NotificationService.notifyMany(customerAdminIds, 'SUBSCRIPTION_EXPIRY', customerMessage, undefined, tx)
                await tx.companyPayment.update({
                    where: { id: payment.id },
                    data: { remindersSent: { push: decision.markSent } }
                })
            })

            notificationsCreated += superAdminIds.length + platformUserIds.length + customerAdminIds.length
            remindersSent++
        }

        return { expiringFound: expiringPayments.length, remindersSent, notificationsSent: notificationsCreated }
    }
}
