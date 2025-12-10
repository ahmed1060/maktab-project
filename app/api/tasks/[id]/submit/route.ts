import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function PUT(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    const json = await req.json()
    const { newAttachments, note, cost, costDescription, isDraft, location } = json
    // Force parse cost to number
    const costValue = cost ? Number(cost) : 0
    console.log(`[API] Submit Task ${params.id}: cost=${costValue}, attachments=${newAttachments?.length || 0}, isDraft=${isDraft}, location=${location}`)

    const userId = (session.user as any).id

    const result = await prisma.$transaction(async (tx) => {
        // 1. Get current task to read existing comments and attachments
        const currentTask = await tx.task.findUnique({ where: { id: params.id } })
        if (!currentTask) throw new Error("Task not found")

        // Parse existing attachments
        let finalAttachments: any[] = []
        if (currentTask.attachments) {
            try {
                const parsed = JSON.parse(currentTask.attachments)
                if (Array.isArray(parsed)) {
                    finalAttachments = parsed
                } else if (parsed.url) {
                    // Convert legacy single to array
                    finalAttachments = [parsed]
                }
            } catch (e) {
                finalAttachments = []
            }
        }

        // Add new attachments if provided
        if (newAttachments && Array.isArray(newAttachments)) {
            finalAttachments = [...finalAttachments, ...newAttachments]
        }

        let comments = []
        if (currentTask.comments) {
            try {
                comments = JSON.parse(currentTask.comments)
            } catch (e) {
                comments = []
            }
        }

        if (note) {
            comments.push({
                text: note,
                author: (session.user as any).name || 'Employee',
                date: new Date().toISOString(),
                type: 'SUBMISSION_NOTE'
            })
        }

        // Add cost to note if provided (Legacy single cost)
        let totalAdded = 0
        if (costValue > 0) {
            comments.push({
                text: `Added cost: ${costValue.toFixed(2)} EGP`,
                description: costDescription || `Added cost: ${costValue.toFixed(2)} EGP`,
                amount: costValue,
                author: (session.user as any).name || 'Employee',
                date: new Date().toISOString(),
                type: 'COST_ADDITION'
            })
            totalAdded += costValue
        }

        // Handle multiple costs array
        if (json.costs && Array.isArray(json.costs)) {
            for (const c of json.costs) {
                const cVal = Number(c.amount)
                if (cVal > 0) {
                    comments.push({
                        text: `Added cost: ${cVal.toFixed(2)} EGP`,
                        description: c.description || `Added cost: ${cVal.toFixed(2)} EGP`,
                        amount: cVal,
                        author: (session.user as any).name || 'Employee',
                        date: new Date().toISOString(),
                        type: 'COST_ADDITION'
                    })
                    totalAdded += cVal
                }
            }
        }

        // Add location to comments if provided
        if (location) {
            comments.push({
                text: `Location: ${location}`,
                location: location,
                author: (session.user as any).name || 'Employee',
                date: new Date().toISOString(),
                type: 'LOCATION_ADDED'
            })
        }

        // Prepare update data
        const updateData: any = {
            status: isDraft ? 'IN_PROGRESS' : 'PENDING_CONFIRMATION',
            attachments: JSON.stringify(finalAttachments),
            comments: JSON.stringify(comments)
        }

        // Add cost to totalCost if cost > 0 (even for drafts)
        if (totalAdded > 0) {
            updateData.totalCost = {
                increment: totalAdded
            }
        }

        const task = await tx.task.update({
            where: { id: params.id },
            data: updateData
        })

        // Notify the creator (Admin) only if submitted
        if (!isDraft) {
            await tx.notification.create({
                data: {
                    userId: task.createdBy,
                    type: 'TASK_SUBMITTED',
                    message: `Task "${task.title}" has been submitted by ${(session.user as any).name || 'Employee'}`,
                    relatedId: task.id
                }
            })
        }

        // Audit log
        await tx.auditLog.create({
            data: {
                action: isDraft ? 'UPDATE_TASK_PROGRESS' : 'SUBMIT_TASK',
                entityType: 'TASK',
                entityId: task.id,
                userId: userId,
                details: JSON.stringify({ newAttachments, note, cost: costValue, isDraft, location })
            }
        })

        return task
    })

    return NextResponse.json(result)
}
