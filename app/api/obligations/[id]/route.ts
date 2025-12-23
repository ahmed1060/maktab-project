import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function PUT(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    const json = await req.json()
    const { status, newAttachments, assigneeId } = json
    const userId = (session.user as any).id

    const result = await prisma.$transaction(async (tx) => {
        // Get current obligation
        const currentObligation = await tx.obligation.findUnique({ where: { id: params.id } })
        if (!currentObligation) throw new Error("Obligation not found")

        // Authorization Check
        const isManager = ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes((session.user as any).role)
        const isAssignee = currentObligation.assigneeId === userId

        if (!isManager && !isAssignee) {
            throw new Error("Unauthorized to update this obligation")
        }

        // Parse existing attachments
        let finalAttachments: any[] = []
        if (currentObligation.attachments) {
            try {
                const parsed = JSON.parse(currentObligation.attachments)
                if (Array.isArray(parsed)) {
                    finalAttachments = parsed
                } else if (parsed.url) {
                    finalAttachments = [parsed]
                }
            } catch {
                finalAttachments = []
            }
        }

        // Add new attachments
        if (newAttachments && Array.isArray(newAttachments)) {
            finalAttachments = [...finalAttachments, ...newAttachments]
        }

        const updateData: any = {
            attachments: JSON.stringify(finalAttachments)
        }
        if (status) updateData.status = status
        if (status === 'COMPLETED') updateData.lastStatusUpdateBy = `${(session.user as any).role} ${(session.user as any).name}`

        // Handle Reassignment
        if (assigneeId && isManager) {
            updateData.assigneeId = assigneeId
        }

        const obligation = await tx.obligation.update({
            where: { id: params.id },
            data: updateData,
            include: { assignee: true }
        })

        // Add difficulty points to assignee if completed (AND if status actually changed to completed)
        if (status === 'COMPLETED' && currentObligation.status !== 'COMPLETED') {
            await tx.user.update({
                where: { id: obligation.assigneeId },
                data: {
                    totalDifficultyPoints: {
                        increment: obligation.difficulty
                    }
                }
            })
        }

        // Audit log
        await tx.auditLog.create({
            data: {
                action: 'UPDATE_OBLIGATION',
                entityType: 'OBLIGATION',
                entityId: obligation.id,
                userId: (session.user as any).role === 'SUPER_ADMIN' ? null : userId,
                superAdminId: (session.user as any).role === 'SUPER_ADMIN' ? userId : null,
                details: JSON.stringify({ status, newAttachments })
            }
        })

        return obligation
    })

    return NextResponse.json(result)
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes((session.user as any).role)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        await prisma.$transaction(async (tx) => {
            // Get obligation details before deleting
            const obligation = await tx.obligation.findUnique({
                where: { id: params.id },
                select: { status: true, difficulty: true, assigneeId: true }
            })

            // If obligation was completed, deduct points from assignee
            if (obligation && obligation.status === 'COMPLETED') {
                try {
                    await tx.user.update({
                        where: { id: obligation.assigneeId },
                        data: {
                            totalDifficultyPoints: {
                                decrement: obligation.difficulty
                            }
                        }
                    })
                } catch (error) {
                    console.error("Failed to deduct points during obligation deletion:", error)
                }
            }

            // Delete the obligation
            await tx.obligation.delete({
                where: { id: params.id }
            })
        })

        return new NextResponse("Obligation deleted", { status: 200 })
    } catch (error) {
        console.error("Error deleting obligation:", error)
        return new NextResponse("Failed to delete obligation", { status: 500 })
    }
}
