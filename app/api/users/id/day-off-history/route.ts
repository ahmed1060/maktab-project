import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function GET(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: params.id },
            select: {
                dayOffCredit: true,
                baseDayOffCredit: true,
            }
        })

        if (!user) {
            return new NextResponse("User not found", { status: 404 })
        }

        // Fetch all APPROVED requests (both CREDIT and SALARY)
        const requests = await prisma.dayOffRequest.findMany({
            where: {
                userId: params.id,
                status: 'APPROVED'
            },
            orderBy: {
                date: 'desc'
            }
        })

        // Fetch all snapshots
        const snapshots = await prisma.dayOffCreditSnapshot.findMany({
            where: {
                userId: params.id
            },
            orderBy: {
                year: 'desc'
            }
        })

        // Grouping logic
        const years = Array.from(new Set([
            ...requests.map(r => new Date(r.date).getFullYear()),
            ...snapshots.map(s => s.year)
        ])).sort((a, b) => b - a)

        const historyByYear = years.map(year => {
            return {
                year,
                snapshot: snapshots.find(s => s.year === year) || null,
                requests: requests.filter(r => new Date(r.date).getFullYear() === year)
            }
        })

        return NextResponse.json({
            baseCredit: user.baseDayOffCredit,
            remainingCredit: user.dayOffCredit,
            history: historyByYear
        })
    } catch (error) {
        console.error('Error fetching day off history:', error)
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
    }
}
