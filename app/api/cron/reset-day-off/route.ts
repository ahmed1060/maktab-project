import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function GET(request: NextRequest) {
    const session = await getServerSession(authOptions)
    const authHeader = request.headers.get('authorization')

    // Allow if it's a valid CRON secret OR a Super Admin manual trigger
    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

    if (!isCron && !isSuperAdmin) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        const now = new Date()
        const currentYear = now.getFullYear()

        // Find users whose reset year is NOT the current year
        const usersToReset = await prisma.user.findMany({
            where: {
                lastDayOffResetYear: {
                    lt: currentYear
                }
            }
        })

        let count = 0
        for (const user of usersToReset) {
            try {
                await prisma.$transaction(async (tx) => {
                    // 1. Create Snapshot for the year that just ended
                    await tx.dayOffCreditSnapshot.create({
                        data: {
                            userId: user.id,
                            year: user.lastDayOffResetYear,
                            baseCredit: user.baseDayOffCredit,
                            remainingCredit: user.dayOffCredit
                        }
                    })

                    // 2. Reset Credit to Base for the NEW year
                    await tx.user.update({
                        where: { id: user.id },
                        data: {
                            dayOffCredit: user.baseDayOffCredit,
                            lastDayOffResetYear: currentYear
                        }
                    })
                })
                count++
            } catch (err) {
                console.error(`Failed to reset user ${user.id}:`, err)
            }
        }

        return NextResponse.json({
            success: true,
            message: `Reset completed for ${count} users for the year ${currentYear}.`
        })
    } catch (error) {
        console.error('Error in cron reset-day-off:', error)
        return NextResponse.json({ error: 'Reset failed' }, { status: 500 })
    }
}
