import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    const session = await getServerSession(authOptions)
    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const where: any = {}
    if (session.user.role === 'SUPER_ADMIN') {
        if (companyId) {
            where.user = { companyId }
        }
    } else {
        where.user = { companyId: session.user.companyId }
    }

    const requests = await prisma.dayOffRequest.findMany({
        where,
        include: {
            user: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    role: true,
                    dayOffCredit: true
                }
            }
        },
        orderBy: { createdAt: 'desc' }
    })

    return NextResponse.json(requests)
}
