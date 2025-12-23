import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: Request) {
    try {
        // Simple security check using CRON_SECRET if available
        const authHeader = req.headers.get('Authorization')
        const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`

        // Also allow manual trigger from Super Admin if needed (will require a bit more setup if used in real UI)
        // For now, let's stick to Cron/Manual Bearer Auth for simplicity
        if (!isCron && process.env.NODE_ENV === 'production') {
            return new NextResponse("Unauthorized", { status: 401 })
        }

        const now = new Date()
        const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

        // 1. Find PAID payments expiring within 14 days that haven't been notified
        const expiringPayments = await prisma.companyPayment.findMany({
            where: {
                status: 'PAID',
                endDate: {
                    gt: now,
                    lte: fourteenDaysFromNow
                },
                notifiedExpiryReminder: false
            },
            include: {
                company: {
                    select: { name: true }
                }
            }
        })

        if (expiringPayments.length === 0) {
            return NextResponse.json({ message: "No expiring subscriptions found", checkedAt: now.toISOString() })
        }

        // 2. Fetch all Super Admins
        // We need Super Admins from both the SuperAdmin table and the User table (where role = SUPER_ADMIN)
        const adminsFromTable = await prisma.superAdmin.findMany({ select: { id: true } })
        const adminsFromUserRole = await prisma.user.findMany({
            where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
            select: { id: true }
        })

        // Combine IDs (unique)
        const allAdminIds = Array.from(new Set([
            ...adminsFromTable.map(a => a.id),
            ...adminsFromUserRole.map(a => a.id)
        ]))

        let notificationsCreated = 0

        // 3. Create notifications for each admin for each expiring payment
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

        return NextResponse.json({
            success: true,
            expiringFound: expiringPayments.length,
            notificationsSent: notificationsCreated,
            checkedAt: now.toISOString()
        })

    } catch (error) {
        console.error('Subscription check failed:', error)
        return NextResponse.json({ error: 'Failed to check subscriptions' }, { status: 500 })
    }
}
