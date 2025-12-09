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

        // Update all tasks to PAID and COMPLETED
        const result = await prisma.task.updateMany({
            where: {
                id: { in: taskIds },
                paymentStatus: 'PENDING_PAYMENT'
            },
            data: {
                paymentStatus: 'PAID',
                status: 'COMPLETED'
            }
        })

        // Log the bulk payment update
        await prisma.auditLog.create({
            data: {
                action: 'BULK_UPDATE_PAYMENT_STATUS',
                entityType: 'TASK',
                entityId: 'BULK',
                userId: (session.user as any).id,
                details: JSON.stringify({
                    taskIds,
                    count: result.count,
                    paymentStatus: 'PAID'
                })
            }
        })

        return NextResponse.json({ success: true, count: result.count })
    } catch (error) {
        console.error("Bulk payment status update failed", error)
        return new NextResponse("Internal error", { status: 500 })
    }
}
