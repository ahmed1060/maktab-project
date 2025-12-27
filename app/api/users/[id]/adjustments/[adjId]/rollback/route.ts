import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function POST(req: Request, { params }: { params: { id: string, adjId: string } }) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role

    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        const adjustment = await prisma.salaryAdjustment.findUnique({
            where: { id: params.adjId }
        })

        if (!adjustment || adjustment.status === 'ROLLED_BACK') {
            return new NextResponse("Invalid adjustment or already rolled back", { status: 400 })
        }

        const date = new Date(adjustment.createdAt)
        const month = date.getMonth() + 1
        const year = date.getFullYear()

        const record = await prisma.salaryRecord.findUnique({
            where: { userId_month_year: { userId: params.id, month, year } }
        })

        if (!record) {
            return new NextResponse("Salary record not found for this month", { status: 404 })
        }

        await prisma.$transaction([
            prisma.salaryAdjustment.update({
                where: { id: params.adjId },
                data: { status: 'ROLLED_BACK' }
            }),
            prisma.salaryRecord.update({
                where: { id: record.id },
                data: {
                    bonusDays: adjustment.type === 'BONUS' ? { decrement: adjustment.amount } : undefined,
                    deductions: adjustment.type === 'DEDUCTION' ? { decrement: adjustment.amount } : undefined
                }
            })
        ])

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error rolling back adjustment:', error)
        return new NextResponse("Failed to rollback adjustment", { status: 500 })
    }
}
