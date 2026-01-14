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

    const creatorCompanyId = (session.user as any).companyId
    const json = await req.json()
    const { title, description, assigneeId, deadline, recurrence, attachments, difficulty = 0 } = json

    if (!title || title.length < 3 || title.length > 100) {
        return new NextResponse("Title must be between 3 and 100 characters", { status: 400 })
    }
    if (!description || description.length < 10 || description.length > 1000) {
        return new NextResponse("Description must be between 10 and 1000 characters", { status: 400 })
    }

    // Security: Verify Cross-Company Assignment
    if (userRole !== 'SUPER_ADMIN') {
        if (!creatorCompanyId) {
            return new NextResponse("You are not part of a company", { status: 403 })
        }

        // Check if assignee is in the same company
        const assigneeUser = await prisma.user.findUnique({
            where: { id: assigneeId },
            select: { companyId: true, role: true }
        })

        if (!assigneeUser || assigneeUser.companyId !== creatorCompanyId) {
            return new NextResponse("Cannot assign obligation to user in a different company", { status: 403 })
        }

        // TEAM_LEADER Restriction: Cannot assign to ADMIN or SUPER_ADMIN
        if (userRole === 'TEAM_LEADER' && ['ADMIN', 'SUPER_ADMIN'].includes(assigneeUser.role)) {
            return new NextResponse("Team Leaders cannot assign obligations to Admins or Super Admins", { status: 403 })
        }
    } else if (userRole === 'SUPER_ADMIN') {
        const assigneeUser = await prisma.user.findUnique({
            where: { id: assigneeId },
            select: { role: true }
        })
        if (!assigneeUser) return new NextResponse("Assignee not found", { status: 404 })
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

    const whereClause: any = {}

    if (role === 'SUPER_ADMIN') {
        if (companyId) {
            whereClause.assignee = { companyId }
        }
    } else if (['ADMIN', 'TEAM_LEADER'].includes(role)) {
        // Strict Company Isolation
        const userCompanyId = (session.user as any).companyId
        if (!userCompanyId) {
            return NextResponse.json([]) // Unassigned Admins see nothing
        }
        whereClause.assignee = { companyId: userCompanyId }
    } else {
        whereClause.assigneeId = userId
    }

    const employeeIdFilter = searchParams.get('employeeId')
    const statusFilter = searchParams.get('status')
    const searchFilter = searchParams.get('search')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (employeeIdFilter && role !== 'EMPLOYEE') {
        whereClause.assigneeId = employeeIdFilter
    }

    if (statusFilter) {
        whereClause.status = statusFilter
    }

    if (searchFilter) {
        whereClause.AND = whereClause.AND || []
        whereClause.AND.push({
            OR: [
                { title: { contains: searchFilter, mode: 'insensitive' } },
                { description: { contains: searchFilter, mode: 'insensitive' } }
            ]
        })
    }

    if (dateFrom || dateTo) {
        whereClause.updatedAt = {}
        if (dateFrom) whereClause.updatedAt.gte = new Date(dateFrom)
        if (dateTo) {
            const end = new Date(dateTo)
            end.setHours(23, 59, 59, 999)
            whereClause.updatedAt.lte = end
        }
    }

    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    const [obligations, total] = await Promise.all([
        prisma.obligation.findMany({
            where: whereClause,
            include: { assignee: { select: { firstName: true, lastName: true } } },
            orderBy: { deadline: 'asc' },
            skip,
            take: limit
        }),
        prisma.obligation.count({ where: whereClause })
    ])

    return NextResponse.json({
        data: obligations,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    })
}
