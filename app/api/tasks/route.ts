import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function GET() {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role
    const userId = (session?.user as any)?.id

    if (!session) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    // ADMIN, SUPER_ADMIN, and TEAM_LEADER see all tasks; EMPLOYEE sees only assigned tasks
    const tasks = await prisma.task.findMany({
        where: ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)
            ? {}
            : { assigneeId: userId },
        include: {
            assignee: {
                select: { firstName: true, lastName: true, email: true }
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
    const { title, description, assigneeId, deadline, difficulty = 0 } = json
    const creatorId = (session.user as any).id

    // Server-side Deadline Validation
    const deadlineDate = new Date(deadline)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // We allow "today" so we check strict less than
    if (deadlineDate < today) {
        return new NextResponse(JSON.stringify({ message: "Deadline cannot be in the past" }), { status: 400 })
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
                    createdBy: creatorId
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
                    userId: creatorId,
                    details: JSON.stringify({ title, assigneeId })
                }
            })

            return task
        })

        return NextResponse.json(result)
    } catch (error: any) {
        console.error("Error creating task:", error)
        return new NextResponse(JSON.stringify({ message: error.message || "Internal Server Error" }), { status: 500 })
    }
}
