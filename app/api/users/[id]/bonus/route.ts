import { withStandardHandler } from "@/lib/api-utils"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyResourceAccess } from "@/lib/security"

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const userId = params.id
    const userRole = session.user.role

    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const hasAccess = await verifyResourceAccess(session, userId, 'USER')
    if (!hasAccess) {
        return new NextResponse("Access Denied", { status: 403 })
    }

    const { amount, reason } = json
    if (!amount || typeof amount !== 'number' || amount <= 0 || amount > 1000) {
        return new NextResponse("Invalid amount (1-1000)", { status: 400 })
    }

    const now = new Date()
    const m = now.getMonth() + 1, y = now.getFullYear()

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { salary: true } })
    const currentBase = user?.salary || 0

    await prisma.$transaction(async (tx) => {
        const existingRecord = await tx.salaryRecord.findUnique({
            where: { userId_month_year: { userId, month: m, year: y } }
        })

        if (existingRecord) {
            await tx.salaryRecord.update({
                where: { id: existingRecord.id },
                data: { bonusDays: { increment: amount } }
            })
        } else {
            await tx.salaryRecord.create({
                data: {
                    userId, month: m, year: y,
                    totalDays: new Date(y, m, 0).getDate(),
                    deductions: 0, baseSalary: currentBase, bonusDays: amount
                }
            })
        }

        await tx.salaryAdjustment.create({
            data: { userId, type: 'BONUS', amount, reason: reason || null, status: 'ACTIVE' }
        })

        await tx.notification.create({
            data: {
                userId, type: 'BONUS_ADDED',
                message: `Congratulations! You have received a bonus of ${amount} days.`,
                relatedId: userId
            }
        })
    })

    return NextResponse.json({ success: true, id: userId })
}, {
    audit: { action: 'ADD_BONUS', entityType: 'SALARY_ADJUSTMENT', getEntityId: (res) => res.id }
})
