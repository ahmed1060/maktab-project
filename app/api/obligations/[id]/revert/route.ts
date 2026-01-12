import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { verifyResourceAccess } from "@/lib/security"

export async function POST(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    const userRole = (session.user as any).role
    if (userRole !== 'SUPER_ADMIN') {
        return new NextResponse("Forbidden: Only Super Admins can revert obligations", { status: 403 })
    }

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'OBLIGATION')
    if (!hasAccess) {
        return new NextResponse("Access Denied: Obligation belongs to a different company", { status: 403 })
    }

    try {
        const result = await prisma.$transaction(async (tx) => {
            const obligation = await tx.obligation.findUnique({
                where: { id: params.id },
                select: {
                    id: true,
                    status: true,
                    difficulty: true,
                    assigneeId: true,
                    title: true
                }
            })

            if (!obligation) throw new Error("Obligation not found")

            const validStatuses = ['APPROVED', 'COMPLETED', 'REJECTED', 'PENDING_CONFIRMATION']
            if (!validStatuses.includes(obligation.status)) {
                throw new Error(`Cannot revert obligation with status: ${obligation.status}`)
            }

            // Points were awarded if status was APPROVED or COMPLETED
            const hadPoints = ['APPROVED', 'COMPLETED'].includes(obligation.status)
            const pointDeduction = hadPoints ? obligation.difficulty : 0

            // Update obligation status
            const updatedObligation = await tx.obligation.update({
                where: { id: params.id },
                data: {
                    status: 'IN_PROGRESS',
                    lastStatusUpdateBy: `SUPER_ADMIN ${session.user.name}`
                }
            })

            // Deduct points from assignee
            if (pointDeduction > 0) {
                await tx.user.update({
                    where: { id: obligation.assigneeId },
                    data: {
                        totalDifficultyPoints: {
                            decrement: pointDeduction
                        }
                    }
                })
            }

            // Notify the assignee
            await tx.notification.create({
                data: {
                    userId: obligation.assigneeId,
                    type: 'OBLIGATION_REVERTED',
                    message: `Super Admin has reverted obligation "${obligation.title}" back to In Progress.`,
                    relatedId: obligation.id
                }
            })

            // Determine if user exists in SuperAdmin or User table for AuditLog
            const currentUserId = (session.user as any).id
            const isSuperAdminEntity = await tx.superAdmin.findUnique({ where: { id: currentUserId } })

            // Audit log
            await tx.auditLog.create({
                data: {
                    action: 'REVERT_OBLIGATION',
                    entityType: 'OBLIGATION',
                    entityId: obligation.id,
                    superAdminId: isSuperAdminEntity ? currentUserId : null,
                    userId: isSuperAdminEntity ? null : currentUserId,
                    details: JSON.stringify({
                        oldStatus: obligation.status,
                        newStatus: 'IN_PROGRESS',
                        pointsDeducted: pointDeduction
                    })
                }
            })

            return updatedObligation
        })

        return NextResponse.json(result)
    } catch (error: any) {
        console.error("Obligation reversion failed:", error)
        return new NextResponse(JSON.stringify({
            message: error.message || "Failed to revert obligation",
            details: error.toString()
        }), { status: 500 })
    }
}
