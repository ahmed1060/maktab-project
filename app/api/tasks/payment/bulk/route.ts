import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function POST(req: Request) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    const role = (session.user as any)?.role

    // Only allow ADMIN and SUPER_ADMIN to bulk update payment status
    if (!['ADMIN', 'SUPER_ADMIN'].includes(role)) {
        return new NextResponse("Forbidden", { status: 403 })
    }

    try {
        const { taskIds } = await req.json()

        if (!Array.isArray(taskIds) || taskIds.length === 0) {
            return new NextResponse("Invalid task IDs", { status: 400 })
        }

        const userCompanyId = (session.user as any).companyId
        let finalTaskIds = taskIds

        // For non-Super Admins, only allow tasks from their own company
        if (role !== 'SUPER_ADMIN') {
            if (!userCompanyId) {
                return new NextResponse("Forbidden: No company assigned", { status: 403 })
            }

            const validTasks = await prisma.task.findMany({
                where: {
                    id: { in: taskIds },
                    assignee: { companyId: userCompanyId }
                },
                select: { id: true }
            })
            finalTaskIds = validTasks.map(t => t.id)

            if (finalTaskIds.length === 0) {
                return new NextResponse("Forbidden: Tasks do not belong to your company", { status: 403 })
            }
        }

        // Update all tasks to PAID and COMPLETED
        const resultCount = await prisma.$transaction(async (tx) => {
            const tasks = await tx.task.findMany({
                where: {
                    id: { in: finalTaskIds },
                    paymentStatus: 'PENDING_PAYMENT'
                },
                select: { id: true, memberCosts: true, memberPaymentStatus: true } as any
            })

            for (const task of tasks) {
                const newMemberPaymentStatus: Record<string, string> = {}

                // Fetch existing costs to know who to mark as PAID
                const mCosts = typeof (task as any).memberCosts === 'string'
                    ? JSON.parse((task as any).memberCosts)
                    : ((task as any).memberCosts as any || {})

                // Mark everyone who has costs as PAID
                Object.keys(mCosts).forEach(uid => {
                    newMemberPaymentStatus[uid] = 'PAID'
                })

                await tx.task.update({
                    where: { id: (task as any).id as string },
                    data: {
                        paymentStatus: 'PAID',
                        status: 'COMPLETED',
                        memberPaymentStatus: newMemberPaymentStatus
                    } as any
                })
            }
            return tasks.length
        })

        // Log the bulk payment update
        const auditData: any = {
            action: 'BULK_UPDATE_PAYMENT_STATUS',
            entityType: 'TASK',
            entityId: 'BULK',
            details: JSON.stringify({
                taskIds: finalTaskIds,
                count: resultCount,
                paymentStatus: 'PAID'
            })
        }

        if (role === 'SUPER_ADMIN') {
            auditData.superAdminId = (session.user as any).id
        } else {
            auditData.userId = (session.user as any).id
        }

        await prisma.auditLog.create({
            data: auditData
        })

        return NextResponse.json({ success: true, count: resultCount })
    } catch (error) {
        console.error("Bulk payment status update failed", error)
        return new NextResponse("Internal error", { status: 500 })
    }
}
