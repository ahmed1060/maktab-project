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
        whereClause.assigneeId = userId
    }

    const tasks = await prisma.task.findMany({
        where: whereClause,
        include: {
            assignee: {
                select: { firstName: true, lastName: true, email: true }
            },
            creator: {
                select: { firstName: true, lastName: true }
            }
        },
        orderBy: { deadline: 'asc' }
    })

    return NextResponse.json(tasks)
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role

    if (!session || !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const json = await req.json()
    const { title, description, assigneeId, deadline, difficulty = 0, location } = json

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

        // Check if assignee is in the same company
        const assigneeUser = await prisma.user.findUnique({
            where: { id: assigneeId },
            select: { companyId: true, role: true }
        })

        if (!assigneeUser || assigneeUser.companyId !== creatorCompanyId) {
            return new NextResponse("Cannot assign task to user in a different company", { status: 403 })
        }

        // TEAM_LEADER Restriction: Cannot assign to ADMIN or SUPER_ADMIN
        if (userRole === 'TEAM_LEADER' && ['ADMIN', 'SUPER_ADMIN'].includes(assigneeUser.role)) {
            return new NextResponse("Team Leaders cannot assign tasks to Admins or Super Admins", { status: 403 })
        }
    } else if (userRole === 'SUPER_ADMIN') {
        const assigneeUser = await prisma.user.findUnique({
            where: { id: assigneeId },
            select: { role: true }
        })
        if (!assigneeUser) return new NextResponse("Assignee not found", { status: 404 })
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
                    assigneeId,
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

            // Create notification for assignee
            await tx.notification.create({
                data: {
                    userId: assigneeId,
                    type: 'TASK_ASSIGNED',
                    message: `You have been assigned a new task: ${title}`,
                    relatedId: task.id
                }
            })

            // Create audit log
            await tx.auditLog.create({
                data: {
                    action: 'CREATE_TASK',
                    entityType: 'TASK',
                    entityId: task.id,
                    userId: userRole === 'SUPER_ADMIN' ? null : creatorId,
                    superAdminId: userRole === 'SUPER_ADMIN' ? creatorId : null,
                    details: JSON.stringify({ title, assigneeId, location })
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
