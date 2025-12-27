import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function POST(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role

    // Only Admin/SuperAdmin can add bonuses
    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        const userId = params.id
        const json = await req.json()
        const { amount } = json

        if (!amount || typeof amount !== 'number' || amount <= 0 || amount > 1000) {
            return new NextResponse("Invalid amount (must be positive and <= 1000)", { status: 400 })
        }

        const now = new Date()
        const currentMonth = now.getMonth() + 1
        const currentYear = now.getFullYear()

        // 1. Get User's current salary for baseSalary fallback
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { salary: true }
        })
        const currentBase = user?.salary || 0

        // 2. Find or Create Record
        const existingRecord = await prisma.salaryRecord.findUnique({
            where: { userId_month_year: { userId, month: currentMonth, year: currentYear } }
        })

        if (existingRecord) {
            await prisma.$transaction([
                prisma.salaryRecord.update({
                    where: { id: existingRecord.id },
                    data: { bonusDays: { increment: amount } }
                }),
                prisma.salaryAdjustment.create({
                    data: {
                        userId,
                        type: 'BONUS',
                        amount,
                        status: 'ACTIVE'
                    }
                })
            ])
        } else {
            const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
            await prisma.$transaction([
                prisma.salaryRecord.create({
                    data: {
                        userId,
                        month: currentMonth,
                        year: currentYear,
                        totalDays: daysInMonth,
                        deductions: 0,
                        baseSalary: currentBase,
                        bonusDays: amount
                    }
                }),
                prisma.salaryAdjustment.create({
                    data: {
                        userId,
                        type: 'BONUS',
                        amount,
                        status: 'ACTIVE'
                    }
                })
            ])
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error adding bonus:', error)
        return new NextResponse("Failed to add bonus", { status: 500 })
    }
}
