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
        const { paymentStatus, targetUserId } = await req.json()

        if (!['PENDING_PAYMENT', 'PAID'].includes(paymentStatus)) {
            return new NextResponse("Invalid payment status", { status: 400 })
        }

        const currentTask = await prisma.task.findUnique({
            where: { id: params.id },
            include: { assignees: true }
        })
        if (!currentTask) return new NextResponse("Task not found", { status: 404 })

        const updateData: any = {}
        let newMemberPaymentStatus: Record<string, string> = {}

        if ((currentTask as any).memberPaymentStatus) {
            try {
                const raw = (currentTask as any).memberPaymentStatus
                newMemberPaymentStatus = typeof raw === 'string' ? JSON.parse(raw) : (raw as any)
            } catch { newMemberPaymentStatus = {} }
        }

        if (targetUserId) {
            // Update individual status
            newMemberPaymentStatus[targetUserId] = paymentStatus
            updateData.memberPaymentStatus = newMemberPaymentStatus

            // Determine if the WHOLE task should be marked as PAID
            // It should be PAID if all current members in memberPaymentStatus are marked as PAID
            const allPaid = Object.values(newMemberPaymentStatus).every(status => status === 'PAID')

            if (allPaid) {
                updateData.paymentStatus = 'PAID'
                updateData.status = 'COMPLETED'
            } else {
                updateData.paymentStatus = 'PENDING_PAYMENT'
                updateData.status = 'APPROVED' // Keep it in approved if not all are paid
            }
        } else {
            // Legacy/Bulk: Set everything to PAID
            updateData.paymentStatus = paymentStatus
            if (paymentStatus === 'PAID') {
                updateData.status = 'COMPLETED'
                // Update all members to PAID
                const allAssigneeIds = currentTask.assignees.map(a => a.id)
                allAssigneeIds.forEach(id => {
                    newMemberPaymentStatus[id] = 'PAID'
                })
                updateData.memberPaymentStatus = newMemberPaymentStatus
            } else {
                updateData.status = 'APPROVED'
                // Optional: set all to PENDING? 
                // Setting all back to PENDING if marking task as PENDING
                Object.keys(newMemberPaymentStatus).forEach(id => {
                    newMemberPaymentStatus[id] = 'PENDING_PAYMENT'
                })
                updateData.memberPaymentStatus = newMemberPaymentStatus
            }
        }

        const task = await prisma.task.update({
            where: { id: params.id },
            data: updateData as any
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
                    paymentStatus: updateData.paymentStatus || task.paymentStatus,
                    targetUserId,
                    taskStatus: updateData.status || task.status,
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
