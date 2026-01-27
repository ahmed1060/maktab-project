import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { verifyResourceAccess } from "@/lib/security"

export async function PUT(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'OBLIGATION')
    if (!hasAccess) {
        return new NextResponse("Access Denied: Obligation belongs to a different company", { status: 403 })
    }

    const json = await req.json()
    const { status, newAttachments, assigneeIds } = json
    const finalAssigneeIds: string[] = assigneeIds || []
    const userId = (session.user as any).id

    try {
        const result = await prisma.$transaction(async (tx) => {
            // Get current obligation with assignees
            const currentObligation = await tx.obligation.findUnique({
                where: { id: params.id },
                include: { assignees: true }
            })
            if (!currentObligation) throw new Error("Obligation not found")

            // Authorization Check
            const isManager = ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes((session.user as any).role)
            const isAssignee = currentObligation.assignees.some((a: any) => a.id === userId)

            if (!isManager && !isAssignee) {
                throw new Error("Unauthorized to update this obligation")
            }

            // Self-approval restriction for ADMIN and SUPER_ADMIN
            const userRole = (session.user as any).role
            if (status && (status === 'APPROVED' || status === 'REJECTED') && ['ADMIN', 'SUPER_ADMIN'].includes(userRole) && isAssignee) {
                throw new Error("Admins cannot approve or reject their own obligations")
            }
            // TEAM_LEADER is allowed to approve/reject their own obligations

            // Parse existing attachments
            let finalAttachments: any[] = []
            if (currentObligation.attachments) {
                try {
                    const parsed = JSON.parse(currentObligation.attachments)
                    if (Array.isArray(parsed)) {
                        finalAttachments = parsed
                    } else if (parsed && typeof parsed === 'object' && (parsed as any).url) {
                        finalAttachments = [parsed]
                    }
                } catch {
                    finalAttachments = []
                }
            }

            // Handle existing attachments removal/update
            if (json.attachments && Array.isArray(json.attachments)) {
                const oldAttachments = finalAttachments
                const requestedAttachments = json.attachments

                // Identify removed items
                const removedItems = oldAttachments.filter(old => !requestedAttachments.some((req: any) => (req.url || req) === (old.url || old)))

                if (removedItems.length > 0) {
                    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(userRole)
                    for (const item of removedItems) {
                        const isAuthor = item.uploadedById === userId
                        if (!isAuthor && !isAdmin) {
                            throw new Error("You are not authorized to remove attachments uploaded by others")
                        }
                    }
                }
                finalAttachments = requestedAttachments
            }

            // Add new attachments
            if (newAttachments && Array.isArray(newAttachments)) {
                finalAttachments = [...finalAttachments, ...newAttachments]
            }

            const updateData: any = {
                attachments: JSON.stringify(finalAttachments)
            }
            if (status) updateData.status = status

            // Set update author
            if (status === 'APPROVED' || status === 'REJECTED' || status === 'COMPLETED') {
                updateData.lastStatusUpdateBy = `${(session.user as any).role} ${(session.user as any).name}`
            }

            // Handle Reassignment
            if (finalAssigneeIds.length > 0 && isManager) {
                // TEAM_LEADER Restriction: Cannot reassign to ADMIN or SUPER_ADMIN
                if (userRole === 'TEAM_LEADER') {
                    const targetUsers = await tx.user.findMany({
                        where: { id: { in: finalAssigneeIds } },
                        select: { role: true }
                    })
                    if (targetUsers.some(u => ['ADMIN', 'SUPER_ADMIN'].includes(u.role))) {
                        throw new Error("Team Leaders cannot reassign obligations to Admins or Super Admins")
                    }
                }
                updateData.assignees = {
                    set: finalAssigneeIds.map(id => ({ id }))
                }
            }

            const obligation = await tx.obligation.update({
                where: { id: params.id },
                data: updateData,
                include: { assignees: true }
            })

            // Calculate point delta
            // Points are added if status changes to APPROVED or COMPLETED
            const hasPoints = (s: string) => ['APPROVED', 'COMPLETED'].includes(s)

            const oldHasPoints = hasPoints(currentObligation.status)
            const newHasPoints = hasPoints(status || currentObligation.status)

            if (!oldHasPoints && newHasPoints) {
                // Add points to all assignees
                for (const a of obligation.assignees) {
                    await tx.user.update({
                        where: { id: a.id },
                        data: { totalDifficultyPoints: { increment: obligation.difficulty } }
                    })
                }
            } else if (oldHasPoints && !newHasPoints) {
                // Remove points from all assignees
                for (const a of obligation.assignees) {
                    await tx.user.update({
                        where: { id: a.id },
                        data: { totalDifficultyPoints: { decrement: obligation.difficulty } }
                    })
                }
            }

            // Notifications
            if (status === 'PENDING_CONFIRMATION') {
                // Notify admins? Usually notifications go to users.
                // For now, let's notify the user when admin approves/rejects
            } else if (status === 'APPROVED' || status === 'REJECTED') {
                await tx.notification.createMany({
                    data: obligation.assignees.map((a: any) => ({
                        userId: a.id,
                        type: status === 'APPROVED' ? 'OBLIGATION_APPROVED' : 'OBLIGATION_REJECTED',
                        message: `Your obligation "${obligation.title}" has been ${status === 'APPROVED' ? 'approved' : 'rejected'}.`,
                        relatedId: obligation.id
                    }))
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
    } catch (error: any) {
        console.error("Obligation update failed:", error)
        return new NextResponse(JSON.stringify({
            message: error.message || "Failed to update obligation",
            details: error.toString()
        }), { status: 500 })
    }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })
    const role = (session.user as any).role
    const userId = (session.user as any).id
    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(role)) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    try {
        await prisma.$transaction(async (tx) => {
            // Get obligation details before deleting
            const obligation = await tx.obligation.findUnique({
                where: { id: params.id },
                select: { status: true, difficulty: true, assignees: { select: { id: true } } }
            })

            if (!obligation) throw new Error("Obligation not found")

            // Self-deletion restriction for ADMIN and SUPER_ADMIN
            const isSelfAssigned = obligation.assignees.some((a: any) => a.id === userId)
            if (['ADMIN', 'SUPER_ADMIN'].includes(role) && isSelfAssigned) {
                throw new Error("Admins cannot delete their own obligations")
            }
            // TEAM_LEADER is allowed to delete their own obligations

            // If obligation was completed, deduct points from ALL assignees
            if (obligation && ['APPROVED', 'COMPLETED'].includes(obligation.status)) {
                for (const a of obligation.assignees) {
                    try {
                        await tx.user.update({
                            where: { id: a.id },
                            data: {
                                totalDifficultyPoints: {
                                    decrement: obligation.difficulty
                                }
                            }
                        })
                    } catch (error) {
                        console.error(`Failed to deduct points from user ${a.id} during obligation deletion:`, error)
                    }
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
