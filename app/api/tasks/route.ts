import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function GET(req: Request) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role
    const userId = (session?.user as any)?.id // Explicitly cast to string if needed, assuming auth returns id
    const { searchParams } = new URL(req.url)
    let companyId = searchParams.get('companyId')
    const companyName = searchParams.get('company')

    if (!companyId && companyName) {
        const comp = await prisma.company.findUnique({ where: { name: companyName } })
        if (comp) companyId = comp.id
    }

    if (!session) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const whereClause: any = {}

    // 1. GET Logic Hardening
    if (userRole === 'SUPER_ADMIN') {
        if (companyId) {
            whereClause.assignee = { companyId }
        }
    } else if (['ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        // Strict Company Isolation
        const userCompanyId = (session.user as any).companyId
        if (!userCompanyId) {
            return NextResponse.json([]) // Unassigned Admins see nothing
        }
        whereClause.assignee = { companyId: userCompanyId }
    } else {
        // Employee seeing their own tasks is safe
        whereClause.OR = [
            { assigneeId: userId },
            { assignees: { some: { id: userId } } }
        ]
    }

    // Additional Filters
    const employeeIdFilter = searchParams.get('employeeId')
    const statusFilter = searchParams.get('status')
    const searchFilter = searchParams.get('search')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (employeeIdFilter) {
        // If we already have an OR (as an employee), we need to wrap it in an AND
        const employeeMatch = {
            OR: [
                { assigneeId: employeeIdFilter },
                { assignees: { some: { id: employeeIdFilter } } }
            ]
        }
        if (whereClause.OR) {
            whereClause.AND = [{ OR: whereClause.OR }, employeeMatch]
            delete whereClause.OR
        } else {
            whereClause.AND = whereClause.AND || []
            whereClause.AND.push(employeeMatch)
        }
    }

    if (statusFilter) {
        whereClause.status = statusFilter
    }

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
                assignee: {
                    select: { id: true, firstName: true, lastName: true, email: true }
                },
                assignees: {
                    select: { id: true, firstName: true, lastName: true, email: true }
                },
                creator: {
                    select: { firstName: true, lastName: true }
                }
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
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role

    if (!session || !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const json = await req.json()
    const { title, description, assigneeId, assigneeIds, deadline, difficulty = 0, location } = json

    // Support plural assigneeIds, fallback to assigneeId for backward compatibility
    const finalAssigneeIds: string[] = assigneeIds || (assigneeId ? [assigneeId] : [])
    const primaryAssigneeId = finalAssigneeIds[0] || assigneeId

    if (!title || title.length < 3 || title.length > 100) {
        return new NextResponse(JSON.stringify({ message: "Title must be between 3 and 100 characters" }), { status: 400 })
    }
    if (!description || description.length < 10 || description.length > 1000) {
        return new NextResponse(JSON.stringify({ message: "Description must be between 10 and 1000 characters" }), { status: 400 })
    }
    const creatorId = (session.user as any).id
    const creatorCompanyId = (session.user as any).companyId

    // 2. POST Logic Hardening: Verify Cross-Company Assignment
    if (userRole !== 'SUPER_ADMIN') {
        if (!creatorCompanyId) {
            return new NextResponse("You are not part of a company", { status: 403 })
        }

        // Check if all assignees are in the same company
        const assigneeUsers = await prisma.user.findMany({
            where: { id: { in: finalAssigneeIds } },
            select: { id: true, companyId: true, role: true }
        })

        if (assigneeUsers.length !== finalAssigneeIds.length) {
            return new NextResponse("One or more assignees not found", { status: 404 })
        }

        const externalAssignee = assigneeUsers.find(u => u.companyId !== creatorCompanyId)
        if (externalAssignee) {
            return new NextResponse("Cannot assign task to user in a different company", { status: 403 })
        }

        // TEAM_LEADER Restriction: Cannot assign to ADMIN or SUPER_ADMIN
        if (userRole === 'TEAM_LEADER') {
            const adminAssignee = assigneeUsers.find(u => ['ADMIN', 'SUPER_ADMIN'].includes(u.role))
            if (adminAssignee) {
                return new NextResponse("Team Leaders cannot assign tasks to Admins or Super Admins", { status: 403 })
            }
        }
    } else if (userRole === 'SUPER_ADMIN') {
        const assigneeUsersCount = await prisma.user.count({
            where: { id: { in: finalAssigneeIds } }
        })
        if (assigneeUsersCount !== finalAssigneeIds.length) return new NextResponse("One or more assignees not found", { status: 404 })
    }

    // Server-side Deadline Validation
    if (!deadline) {
        return new NextResponse("Deadline is required", { status: 400 })
    }
    const deadlineDate = new Date(deadline)
    if (isNaN(deadlineDate.getTime())) {
        return new NextResponse("Invalid deadline date format", { status: 400 })
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // We allow "today" so we check strict less than
    if (deadlineDate < today) {
        return new NextResponse("Deadline cannot be in the past", { status: 400 })
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            const task = await tx.task.create({
                data: {
                    title,
                    description,
                    assigneeId: primaryAssigneeId,
                    assignees: {
                        connect: finalAssigneeIds.map(id => ({ id }))
                    },
                    deadline: new Date(deadline),
                    difficulty: Math.min(Math.max(difficulty, 0), 10), // Ensure 0-10 range
                    status: 'PENDING',
                    location: location,
                    createdBy: userRole === 'SUPER_ADMIN' ? null : creatorId,
                    // Store Super Admin creator info in comments since there is no FK relationship
                    comments: userRole === 'SUPER_ADMIN' ? JSON.stringify([{
                        text: "Task created by Super Admin",
                        author: "System",
                        date: new Date().toISOString()
                    }]) : undefined
                }
            })

            // Create notifications for all assignees
            await tx.notification.createMany({
                data: finalAssigneeIds.map(id => ({
                    userId: id,
                    type: 'TASK_ASSIGNED',
                    message: `You have been assigned a new task: ${title}`,
                    relatedId: task.id
                }))
            })

            // Create audit log
            await tx.auditLog.create({
                data: {
                    action: 'CREATE_TASK',
                    entityType: 'TASK',
                    entityId: task.id,
                    userId: userRole === 'SUPER_ADMIN' ? null : creatorId,
                    superAdminId: userRole === 'SUPER_ADMIN' ? creatorId : null,
                    details: JSON.stringify({ title, assigneeIds: finalAssigneeIds, location })
                }
            })

            return task
        })

        return NextResponse.json(result)
    } catch (error: any) {
        console.error("Error creating task:", error)
        return new NextResponse(JSON.stringify({
            message: error.message || "Internal Server Error",
            details: error.toString(),
            code: (error as any).code,
            meta: (error as any).meta
        }), { status: 500 })
    }
}
