import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { prisma } from "@/lib/prisma"
import { authOptions } from "@/lib/auth"

export async function POST(req: Request) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role
    const creatorId = (session?.user as any)?.id
    const creatorCompanyId = (session?.user as any)?.companyId

    if (!session || !['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        const { tasks } = await req.json()

        if (!Array.isArray(tasks) || tasks.length === 0) {
            return new NextResponse(JSON.stringify({ message: "No tasks provided" }), { status: 400 })
        }

        // Limit bulk creation to prevent timeout (e.g., 50 tasks)
        if (tasks.length > 50) {
            return new NextResponse(JSON.stringify({ message: "Maximum 50 tasks allowed in one bulk upload" }), { status: 400 })
        }

        // 1. Pre-validation and ID resolution
        // The frontend already did most of this, but we MUST re-verify server-side
        const validTasks: any[] = []
        const allAssigneeIds = Array.from(new Set(tasks.flatMap(t => t.assigneeIds || [])))

        // Fetch all potential assignees to check company and role constraints
        const assigneeUsers = await prisma.user.findMany({
            where: { id: { in: allAssigneeIds } },
            select: { id: true, companyId: true, role: true }
        })

        const userMap = new Map(assigneeUsers.map(u => [u.id, u]))

        for (const task of tasks) {
            const { title, description, assigneeIds, deadline, difficulty = 0, location } = task

            // Basic validation
            if (!title || title.length < 3 || title.length > 100) continue
            if (!description || description.length < 10 || description.length > 1000) continue
            if (!deadline || isNaN(new Date(deadline).getTime())) continue
            if (!assigneeIds || assigneeIds.length === 0) continue

            // Company & Role Security
            let isTaskValid = true
            for (const aid of assigneeIds) {
                const user = userMap.get(aid)
                if (!user) {
                    isTaskValid = false; break
                }

                if (userRole !== 'SUPER_ADMIN') {
                    if (user.companyId !== creatorCompanyId) {
                        isTaskValid = false; break
                    }
                    if (userRole === 'TEAM_LEADER' && ['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
                        isTaskValid = false; break
                    }
                }
            }

            if (!isTaskValid) continue

            validTasks.push({
                title,
                description,
                status: "PENDING",
                deadline: new Date(deadline),
                difficulty,
                location,
                createdBy: creatorId,
                assigneeId: assigneeIds[0], // Primary assignee for legacy support
                assigneeIds: assigneeIds
            })
        }

        if (validTasks.length === 0) {
            return new NextResponse(JSON.stringify({ message: "No valid tasks found to create" }), { status: 400 })
        }

        // 2. Transactional Creation
        const createdTasks = await prisma.$transaction(async (tx) => {
            const results = []
            for (const tData of validTasks) {
                const { assigneeIds, ...rest } = tData
                const createdTask = await (tx.task as any).create({
                    data: {
                        ...rest,
                        assignees: {
                            connect: assigneeIds.map((id: string) => ({ id }))
                        }
                    }
                })
                results.push(createdTask)

                // Create individual notifications (outside of transaction results if needed, but tx is safer)
                for (const aid of assigneeIds) {
                    await tx.notification.create({
                        data: {
                            userId: aid,
                            type: "TASK_ASSIGNED",
                            message: `New task assigned: ${tData.title}`,
                            relatedId: createdTask.id
                        }
                    })
                }
            }
            return results
        })

        return NextResponse.json({
            success: true,
            createdCount: createdTasks.length,
            message: `Successfully created ${createdTasks.length} tasks`
        })

    } catch (error: any) {
        console.error("[BULK_TASK_CREATE_ERROR]", error)
        // Extract Prisma error details if available
        let errorMessage = error.message || "Internal Server Error"
        if (error.code === 'P2003') {
            errorMessage = "Database constraint violation. Please check if all assigned employees still exist."
        }
        return new NextResponse(JSON.stringify({
            message: errorMessage,
            details: error.meta || error.toString()
        }), { status: 500 })
    }
}
