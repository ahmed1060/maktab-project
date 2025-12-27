import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role

    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        const adjustments = await prisma.salaryAdjustment.findMany({
            where: { userId: params.id },
            orderBy: { createdAt: 'desc' }
        })
        return NextResponse.json(adjustments)
    } catch (error) {
        console.error('Error fetching adjustments:', error)
        return new NextResponse("Failed to fetch adjustments", { status: 500 })
    }
}
