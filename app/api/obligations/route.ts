import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function POST(req: Request) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role

    if (!session || !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const json = await req.json()
    const { title, description, assigneeId, deadline, recurrence, attachments, difficulty = 0 } = json

    if (!title || title.length < 3 || title.length > 100) {
        return new NextResponse("Title must be between 3 and 100 characters", { status: 400 })
    }
    if (!description || description.length < 10 || description.length > 1000) {
        return new NextResponse("Description must be between 10 and 1000 characters", { status: 400 })
    }

    const obligation = await prisma.obligation.create({
        data: {
            title,
            description,
            assigneeId,
            deadline: new Date(deadline),
            recurrence: recurrence || 'ONE_TIME',
            difficulty: Math.min(Math.max(difficulty, 0), 10), // Ensure 0-10 range
            attachments: attachments ? JSON.stringify(attachments) : null,
            status: 'PENDING'
        }
    })

    return NextResponse.json(obligation)
}

export async function GET(req: Request) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    const role = (session.user as any).role
    const userId = (session.user as any).id
    const { searchParams } = new URL(req.url)
    const companyId = searchParams.get('companyId')

    let whereClause: any = {}

    if (['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(role)) {
        if (companyId) {
            whereClause.assignee = { companyId }
        }
    } else {
        whereClause.assigneeId = userId
    }

    const obligations = await prisma.obligation.findMany({
        where: whereClause,
        include: { assignee: { select: { firstName: true, lastName: true } } },
        orderBy: { deadline: 'asc' }
    })
    return NextResponse.json(obligations)
}
