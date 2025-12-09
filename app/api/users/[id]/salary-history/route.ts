import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request, { params }: { params: { id: string } }) {
    try {
        const userId = params.id
        const now = new Date()
        const currentMonth = now.getMonth() + 1 // 1-12
        const currentYear = now.getFullYear()

        // 1. Fetch User to get current salary
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { salary: true }
        })
        const currentBaseSalary = user?.salary || 0

        // 2. Fetch latest record to determine gap
        const latestRecord = await prisma.salaryRecord.findFirst({
            where: { userId },
            orderBy: [{ year: 'desc' }, { month: 'desc' }]
        })

        if (!latestRecord) {
            // No records at all? Create Current Month.
            const exists = await prisma.salaryRecord.findUnique({
                where: { userId_month_year: { userId, month: currentMonth, year: currentYear } }
            })
            if (!exists) {
                const daysInMonth = new Date(currentYear, currentMonth, 0).getDate()
                await prisma.salaryRecord.create({
                    data: {
                        userId,
                        month: currentMonth,
                        year: currentYear,
                        totalDays: daysInMonth,
                        deductions: 0,
                        baseSalary: currentBaseSalary
                    }
                })
            }
        } else {
            // Check for gaps between Latest and Current
            let iterYear = latestRecord.year
            let iterMonth = latestRecord.month

            // Iterate month by month until we reach Current Month
            while (true) {
                // Move to next month
                iterMonth++
                if (iterMonth > 12) {
                    iterMonth = 1
                    iterYear++
                }

                // Stop if we passed current time
                if (iterYear > currentYear || (iterYear === currentYear && iterMonth > currentMonth)) {
                    break
                }

                const exists = await prisma.salaryRecord.findUnique({
                    where: { userId_month_year: { userId, month: iterMonth, year: iterYear } }
                })

                if (!exists) {
                    const daysInIterMonth = new Date(iterYear, iterMonth, 0).getDate()
                    await prisma.salaryRecord.create({
                        data: {
                            userId,
                            month: iterMonth,
                            year: iterYear,
                            totalDays: daysInIterMonth,
                            deductions: 0,
                            baseSalary: currentBaseSalary
                        }
                    })
                }
            }
        }

        // 3. Fetch all records
        const records = await prisma.salaryRecord.findMany({
            where: { userId },
            orderBy: [
                { year: 'desc' },
                { month: 'desc' }
            ]
        })

        return NextResponse.json(records)

    } catch (error) {
        console.error('Error fetching salary history:', error)
        return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
    }
}
