import { prisma } from "@/lib/prisma"
import { CreateCompanyInput, UpdateCompanyInput } from "../validations/company.schema"

export class CompanyService {
    static async create(input: CreateCompanyInput) {
        return await prisma.company.create({
            data: { name: input.name }
        })
    }

    static async update(input: UpdateCompanyInput) {
        const { id, name, isBanned } = input

        const existing = await prisma.company.findUnique({ where: { id } })
        if (!existing) throw new Error("COMPANY_NOT_FOUND")

        // Protection for SHSD
        if (existing.name === 'SHSD' && name && name !== 'SHSD') {
            throw new Error("CANNOT_RENAME_SHSD")
        }

        return await prisma.company.update({
            where: { id },
            data: {
                ...(name && { name }),
                ...(isBanned !== undefined && { isBanned })
            }
        })
    }

    static async delete(id: string) {
        const company = await prisma.company.findUnique({
            where: { id },
            include: { users: { select: { id: true } } }
        })

        if (!company) throw new Error("COMPANY_NOT_FOUND")
        if (company.name === 'SHSD') throw new Error("CANNOT_DELETE_SHSD")

        const userIds = company.users.map(u => u.id)

        return await prisma.$transaction(async (tx) => {
            if (userIds.length > 0) {
                await tx.task.deleteMany({ where: { companyId: id } })
                await tx.obligation.deleteMany({ where: { companyId: id } })
                await tx.notification.deleteMany({ where: { userId: { in: userIds } } })
                await tx.salaryRecord.deleteMany({ where: { userId: { in: userIds } } })
                await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } })
                await tx.user.deleteMany({ where: { id: { in: userIds } } })
            }
            return await tx.company.delete({ where: { id } })
        })
    }

    /**
     * Fetch all payments for a company.
     */
    static async getPayments(companyId: string) {
        return await prisma.companyPayment.findMany({
            where: { companyId },
            orderBy: { createdAt: 'desc' },
            include: { company: { select: { name: true } } }
        })
    }

    /**
     * Create a new unpaid payment record for a company.
     */
    static async createPayment(companyId: string, cost: number, subscriptionType: string) {
        return await prisma.companyPayment.create({
            data: {
                companyId,
                cost,
                subscriptionType,
                status: 'UNPAID'
            }
        })
    }

    /**
     * Mark a payment as PAID and calculate expiration.
     */
    static async updatePaymentStatus(paymentId: string, status: string) {
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

        return await prisma.companyPayment.update({
            where: { id: paymentId },
            data: {
                status: 'PAID',
                paidAt: startDate,
                startDate,
                endDate
            }
        })
    }

    /**
     * Delete an UNPAID payment record.
     */
    static async deletePayment(paymentId: string) {
        const payment = await prisma.companyPayment.findUnique({ where: { id: paymentId } })
        if (!payment) throw new Error("PAYMENT_NOT_FOUND")
        if (payment.status === 'PAID') throw new Error("CANNOT_DELETE_PAID")

        return await prisma.companyPayment.delete({ where: { id: paymentId } })
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
