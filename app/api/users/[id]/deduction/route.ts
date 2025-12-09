import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function POST(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role

    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        const userId = params.id
        const json = await req.json()
        const { amount } = json // Amount in DAYS

        if (!amount || typeof amount !== 'number') {
            return new NextResponse("Invalid amount", { status: 400 })
        }

        const now = new Date()
        const currentMonth = now.getMonth() + 1
        const currentYear = now.getFullYear()

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { salary: true }
        })
        const currentBase = user?.salary || 0

        const existingRecord = await prisma.salaryRecord.findUnique({
            where: { userId_month_year: { userId, month: currentMonth, year: currentYear } }
        })

        if (existingRecord) {
            await prisma.salaryRecord.update({
                where: { id: existingRecord.id },
                data: { deductions: { increment: amount } }
            })
        } else {
            const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
            await prisma.salaryRecord.create({
                data: {
                    userId,
                    month: currentMonth,
                    year: currentYear,
                    totalDays: daysInMonth,
                    deductions: amount, // Start with this deduction
                    baseSalary: currentBase,
                    bonusDays: 0
                }
            })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error adding deduction:', error)
        return new NextResponse("Failed to add deduction", { status: 500 })
    }
}
