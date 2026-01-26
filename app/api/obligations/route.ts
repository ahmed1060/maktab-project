import { withStandardHandler } from "@/lib/api-utils"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const GET = withStandardHandler(async (req, session) => {
    const role = (session.user as any).role
    const userId = (session.user as any).id
    const { searchParams } = new URL(req.url)
    const companyId = searchParams.get('companyId')

    const whereClause: any = {}

    if (role === 'SUPER_ADMIN') {
        if (companyId) {
            whereClause.companyId = companyId
        }
    } else if (['ADMIN', 'TEAM_LEADER'].includes(role)) {
        const userCompanyId = (session.user as any).companyId
        if (!userCompanyId) {
            return NextResponse.json([])
        }
        whereClause.companyId = userCompanyId
    } else {
        whereClause.assignees = { some: { id: userId } }
    }

    const employeeIdFilter = searchParams.get('employeeId')
    const statusFilter = searchParams.get('status')
    const searchFilter = searchParams.get('search')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (employeeIdFilter && role !== 'EMPLOYEE') {
        whereClause.assignees = { some: { id: employeeIdFilter } }
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
            include: { assignees: { select: { firstName: true, lastName: true } } },
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
})

export const POST = withStandardHandler(async (req, session, json) => {
    const userRole = (session.user as any).role
    if (['EMPLOYEE'].includes(userRole)) {
        return new NextResponse("Forbidden", { status: 403 })
    }

    const creatorCompanyId = (session.user as any).companyId
    const { title, description, assigneeIds, deadline, recurrence, attachments, difficulty = 0 } = json
    const finalAssigneeIds: string[] = assigneeIds || []

    if (!title || title.length < 3 || title.length > 100) {
        return new NextResponse("Title must be between 3 and 100 characters", { status: 400 })
    }
    if (!description || description.length < 10 || description.length > 1000) {
        return new NextResponse("Description must be between 10 and 1000 characters", { status: 400 })
    }

    if (userRole !== 'SUPER_ADMIN') {
        if (!creatorCompanyId) return new NextResponse("You are not part of a company", { status: 403 })

        const assigneeUsers = await prisma.user.findMany({
            where: { id: { in: finalAssigneeIds } },
            select: { id: true, companyId: true, role: true }
        })

        if (assigneeUsers.length !== finalAssigneeIds.length) return new NextResponse("One or more assignees not found", { status: 404 })

        const externalAssignee = assigneeUsers.find(u => u.companyId !== creatorCompanyId)
        if (externalAssignee) return new NextResponse("Cannot assign obligation to user in a different company", { status: 403 })

        if (userRole === 'TEAM_LEADER') {
            const adminAssignee = assigneeUsers.find(u => ['ADMIN', 'SUPER_ADMIN'].includes(u.role))
            if (adminAssignee) return new NextResponse("Team Leaders cannot assign obligations to Admins or Super Admins", { status: 403 })
        }
    }

    let finalCompanyId = creatorCompanyId
    if (userRole === 'SUPER_ADMIN' && finalAssigneeIds.length > 0) {
        const firstAssignee = await prisma.user.findUnique({
            where: { id: finalAssigneeIds[0] },
            select: { companyId: true }
        })
        if (firstAssignee) finalCompanyId = firstAssignee.companyId
    }

    const obligation = await prisma.obligation.create({
        data: {
            title,
            description,
            companyId: finalCompanyId,
            assignees: {
                connect: finalAssigneeIds.map(id => ({ id }))
            },
            deadline: new Date(deadline),
            recurrence: recurrence || 'ONE_TIME',
            difficulty: Math.min(Math.max(difficulty, 0), 10),
            attachments: attachments ? JSON.stringify(attachments) : null,
            status: 'PENDING'
        }
    })

    return NextResponse.json(obligation)
}, {
    audit: {
        action: 'CREATE_OBLIGATION',
        entityType: 'OBLIGATION',
        getEntityId: (res) => res.id
    }
})
