import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * Automates the initialization of SalaryRecords for all active employees at the start of each month.
 * Secured by CRON_SECRET.
 */
export async function POST(req: Request) {
    try {
        const authHeader = req.headers.get('Authorization')
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return new NextResponse("Unauthorized", { status: 401 })
        }

        const now = new Date()
        const month = now.getMonth() + 1
        const year = now.getFullYear()
        const daysInMonth = new Date(year, month, 0).getDate()

        // 1. Get all active employees (excluding soft-deleted ones)
        const employees = await prisma.user.findMany({
            where: {
                status: { not: 'DELETED' },
                role: { in: ['EMPLOYEE', 'TEAM_LEADER', 'ADMIN'] }
            },
            select: {
                id: true,
                salary: true,
                role: true
            }
        })

        let createdCount = 0
        let skippedCount = 0

        // 2. Safely initialize records
        for (const employee of employees) {
            try {
                // Check if record already exists (idempotency)
                const existing = await prisma.salaryRecord.findUnique({
                    where: {
                        userId_month_year: {
                            userId: employee.id,
                            month,
                            year
                        }
                    }
                })

                if (!existing) {
                    await prisma.salaryRecord.create({
                        data: {
                            userId: employee.id,
                            month,
                            year,
                            totalDays: daysInMonth,
                            baseSalary: employee.salary || 0,
                            deductions: 0,
                            bonusDays: 0
                        }
                    })
                    createdCount++
                } else {
                    skippedCount++
                }
            } catch (err) {
                console.error(`Failed to init salary for user ${employee.id}:`, err)
            }
        }

        return NextResponse.json({
            success: true,
            month,
            year,
            totalProcessed: employees.length,
            created: createdCount,
            skipped: skippedCount
        })

    } catch (error) {
        console.error('Salary initialization failed:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
