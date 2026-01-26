import { withStandardHandler } from "@/lib/api-utils"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const GET = withStandardHandler(async (req, session) => {
    const userRole = (session.user as any).role
    const userId = (session.user as any).id
    const { searchParams } = new URL(req.url)

    let companyId = searchParams.get('companyId')
    const companyName = searchParams.get('company')

    if (!companyId && companyName) {
        const comp = await prisma.company.findUnique({ where: { name: companyName } })
        if (comp) companyId = comp.id
    }

    const whereClause: any = {}

    // 1. GET Logic Hardening
    if (userRole === 'SUPER_ADMIN') {
        if (companyId) {
            whereClause.companyId = companyId
        }
    } else if (['ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        const userCompanyId = (session.user as any).companyId
        if (!userCompanyId) {
            return NextResponse.json([])
        }
        whereClause.companyId = userCompanyId
    } else {
        whereClause.assignees = { some: { id: userId } }
    }

    // Filters
    const employeeIdFilter = searchParams.get('employeeId')
    const statusFilter = searchParams.get('status')
    const searchFilter = searchParams.get('search')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (employeeIdFilter) whereClause.assignees = { some: { id: employeeIdFilter } }
    if (statusFilter) whereClause.status = statusFilter

    if (searchFilter) {
        const searchOR = {
            OR: [
                { title: { contains: searchFilter, mode: 'insensitive' } },
                { description: { contains: searchFilter, mode: 'insensitive' } }
            ]
        }
        if (whereClause.OR) {
            whereClause.AND = whereClause.AND || []
            whereClause.AND.push({ OR: whereClause.OR })
            delete whereClause.OR
            whereClause.AND.push(searchOR)
        } else {
            whereClause.AND = whereClause.AND || []
            whereClause.AND.push(searchOR)
        }
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

    const [tasks, total] = await Promise.all([
        prisma.task.findMany({
            where: whereClause,
            include: {
                assignees: { select: { id: true, firstName: true, lastName: true, email: true } },
                creator: { select: { firstName: true, lastName: true } }
            },
            orderBy: { deadline: 'asc' },
            skip,
            take: limit
        }),
        (prisma.task as any).count({ where: whereClause })
    ])

    return NextResponse.json({
        data: tasks,
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

    const { title, description, assigneeIds, deadline, difficulty = 0, location, attachments } = json
    const finalAssigneeIds: string[] = assigneeIds || []

    if (!title || title.length < 3 || title.length > 100) {
        return new NextResponse(JSON.stringify({ message: "Title must be between 3 and 100 characters" }), { status: 400 })
    }
    if (!description || description.length < 10 || description.length > 1000) {
        return new NextResponse(JSON.stringify({ message: "Description must be between 10 and 1000 characters" }), { status: 400 })
    }

    const creatorId = (session.user as any).id
    const creatorCompanyId = (session.user as any).companyId

    if (userRole !== 'SUPER_ADMIN') {
        if (!creatorCompanyId) return new NextResponse("You are not part of a company", { status: 403 })

        const assigneeUsers = await prisma.user.findMany({
            where: { id: { in: finalAssigneeIds } },
            select: { id: true, companyId: true, role: true }
        })

        if (assigneeUsers.length !== finalAssigneeIds.length) return new NextResponse("One or more assignees not found", { status: 404 })

        const externalAssignee = assigneeUsers.find(u => u.companyId !== creatorCompanyId)
        if (externalAssignee) return new NextResponse("Cannot assign task to user in a different company", { status: 403 })

        if (userRole === 'TEAM_LEADER') {
            const adminAssignee = assigneeUsers.find(u => ['ADMIN', 'SUPER_ADMIN'].includes(u.role))
            if (adminAssignee) return new NextResponse("Team Leaders cannot assign tasks to Admins or Super Admins", { status: 403 })
        }
    } else {
        const assigneeUsersCount = await prisma.user.count({ where: { id: { in: finalAssigneeIds } } })
        if (assigneeUsersCount !== finalAssigneeIds.length) return new NextResponse("One or more assignees not found", { status: 404 })
    }

    if (!deadline) return new NextResponse("Deadline is required", { status: 400 })
    const deadlineDate = new Date(deadline)
    if (isNaN(deadlineDate.getTime())) return new NextResponse("Invalid deadline date format", { status: 400 })

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (deadlineDate < today) return new NextResponse("Deadline cannot be in the past", { status: 400 })

    const result = await prisma.$transaction(async (tx) => {
        const task = await tx.task.create({
            data: {
                title,
                description,
                companyId: creatorCompanyId,
                assignees: { connect: finalAssigneeIds.map(id => ({ id })) },
                deadline: deadlineDate,
                difficulty: Math.min(Math.max(difficulty, 0), 10),
                status: 'PENDING',
                location: location,
                attachments: attachments ? JSON.stringify(attachments) : null,
                createdBy: userRole === 'SUPER_ADMIN' ? null : creatorId,
                comments: userRole === 'SUPER_ADMIN' ? JSON.stringify([{
                    text: "Task created by Super Admin", author: "System", date: new Date().toISOString()
                }]) : undefined
            }
        })

        await tx.notification.createMany({
            data: finalAssigneeIds.map(id => ({
                userId: id,
                type: 'TASK_ASSIGNED',
                message: `You have been assigned a new task: ${title}`,
                relatedId: task.id
            }))
        })

        return task
    })

    return NextResponse.json(result)
}, {
    audit: {
        action: 'CREATE_TASK',
        entityType: 'TASK',
        getEntityId: (res) => res.id
    }
})
