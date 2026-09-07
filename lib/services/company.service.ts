import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
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
     * Mark a payment as PAID and calculate expiration.
     */
    static async updatePaymentStatus(paymentId: string, status: string, session: any) {
        if (status !== 'PAID') throw new Error("ONLY_PAID_SUPPORTED")

        const payment = await prisma.companyPayment.findUnique({ where: { id: paymentId } })
        if (!payment) throw new Error("PAYMENT_NOT_FOUND")

        const startDate = new Date()
        const endDate = new Date()

        if (payment.subscriptionType === 'MONTHLY') {
            endDate.setDate(startDate.getDate() + 30)
        } else if (payment.subscriptionType === 'ANNUALLY') {
            endDate.setFullYear(startDate.getFullYear() + 1)
        }

        const updated = await prisma.companyPayment.update({
            where: { id: paymentId },
            data: {
                status: 'PAID',
                paidAt: startDate,
                startDate,
                endDate
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
     * Cron-like method to check for expiring subscriptions and notify admins.
     */
    static async checkSubscriptions() {
        const now = new Date()
        const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

        // 1. Find PAID payments expiring within 14 days that haven't been notified
        const expiringPayments = await prisma.companyPayment.findMany({
            where: {
                status: 'PAID',
                endDate: { gt: now, lte: fourteenDaysFromNow },
                notifiedExpiryReminder: false
            },
            include: { company: { select: { name: true } } }
        })

        if (expiringPayments.length === 0) {
            return { message: "No expiring subscriptions found", count: 0 }
        }

        // 2. Fetch all Super Admins
        const adminsFromTable = await prisma.superAdmin.findMany({ select: { id: true } })
        const adminsFromUserRole = await prisma.user.findMany({
            where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
            select: { id: true }
        })

        const allAdminIds = Array.from(new Set([
            ...adminsFromTable.map(a => a.id),
            ...adminsFromUserRole.map(a => a.id)
        ]))

        let notificationsCreated = 0

        // 3. Create notifications
        for (const payment of expiringPayments) {
            const timeLeft = Math.ceil((payment.endDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

            for (const adminId of allAdminIds) {
                await prisma.notification.create({
                    data: {
                        userId: adminId,
                        type: 'SUBSCRIPTION_EXPIRY',
                        message: `Subscription for ${payment.company.name} will expire in ${timeLeft} days (${payment.endDate?.toLocaleDateString()}).`,
                        relatedId: payment.id
                    }
                })
                notificationsCreated++
            }

            // Mark this payment as notified
            await prisma.companyPayment.update({
                where: { id: payment.id },
                data: { notifiedExpiryReminder: true }
            })
        }

        return { expiringFound: expiringPayments.length, notificationsSent: notificationsCreated }
    }
}
