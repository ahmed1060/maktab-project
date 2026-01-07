import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { verifyResourceAccess } from "@/lib/security"

export async function PUT(req: Request, { params }: { params: { id: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) return new NextResponse("Unauthorized", { status: 401 })

    // Company Isolation Check
    const hasAccess = await verifyResourceAccess(session, params.id, 'TASK')
    if (!hasAccess) {
        return new NextResponse("Access Denied: Task belongs to a different company", { status: 403 })
    }

    const role = (session.user as any)?.role

    // Allow ADMIN, SUPER_ADMIN and TEAM_LEADER to update payment status
    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(role)) {
        return new NextResponse("Forbidden", { status: 403 })
    }

    try {
        const { paymentStatus } = await req.json()

        if (!['PENDING_PAYMENT', 'PAID'].includes(paymentStatus)) {
            return new NextResponse("Invalid payment status", { status: 400 })
        }

        // Update payment status and task status
        const updateData: any = { paymentStatus }

        // If marking as paid, change status to COMPLETED
        if (paymentStatus === 'PAID') {
            updateData.status = 'COMPLETED'
        }
        // If marking back to pending payment, change status back to APPROVED
        else if (paymentStatus === 'PENDING_PAYMENT') {
            updateData.status = 'APPROVED'
        }

        const task = await prisma.task.update({
            where: { id: params.id },
            data: updateData
        })

        // Log the payment status change
        await prisma.auditLog.create({
            data: {
                action: 'UPDATE_PAYMENT_STATUS',
                entityType: 'TASK',
                entityId: params.id,
                userId: (session.user as any).role === 'SUPER_ADMIN' ? null : (session.user as any).id,
                superAdminId: (session.user as any).role === 'SUPER_ADMIN' ? (session.user as any).id : null,
                details: JSON.stringify({
                    paymentStatus,
                    taskStatus: updateData.status,
                    taskTitle: task.title
                })
            }
        })

        return NextResponse.json({ success: true, task })
    } catch (error) {
        console.error("Payment status update failed", error)
        return new NextResponse("Internal error", { status: 500 })
    }
}
