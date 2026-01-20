import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { verifyResourceAccess } from "@/lib/security"

export async function GET(request: Request, { params }: { params: { id: string } }) {
    try {
        const session = await getServerSession(authOptions)
        if (!session) return new NextResponse("Unauthorized", { status: 401 })

        const userId = params.id
        const userRole = (session.user as any).role

        // Security check: Only Admins, Super Admins, or Self
        const isSelf = (session.user as any).id === userId
        const isAuthorizedRole = ['ADMIN', 'SUPER_ADMIN'].includes(userRole)

        if (!isSelf && !isAuthorizedRole) {
            return new NextResponse("Forbidden", { status: 403 })
        }

        // Company Isolation Check
        const hasAccess = await verifyResourceAccess(session, userId, 'USER')
        if (!hasAccess) {
            return new NextResponse("Access Denied", { status: 403 })
        }

        // Fetch all tasks where this user is an assignee and has a paid cost
        const tasks = await prisma.task.findMany({
            where: {
                OR: [
                    { assigneeId: userId },
                    { assignees: { some: { id: userId } } }
                ],
                paymentStatus: { in: ['PAID', 'PENDING_PAYMENT'] } // We will filter further in JS
            },
            orderBy: { updatedAt: 'desc' },
            select: {
                id: true,
                title: true,
                updatedAt: true,
                memberCosts: true,
                memberPaymentStatus: true
            }
        })

        // Process results to include all costs for this specific user
        const allCosts = tasks
            .map(task => {
                const memberCosts = (task.memberCosts as any) || {}
                const memberPaymentStatus = (task.memberPaymentStatus as any) || {}

                // Get cost and status for THIS user
                const cost = memberCosts[userId]
                const status = memberPaymentStatus[userId]

                if (cost !== undefined && cost !== null) {
                    return {
                        id: task.id,
                        title: task.title,
                        amount: cost,
                        status: status || 'PENDING_PAYMENT',
                        date: task.updatedAt
                    }
                }
                return null
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)

        return NextResponse.json(allCosts)

    } catch (error) {
        console.error('Error fetching costs history:', error)
        return NextResponse.json({ error: 'Failed to fetch costs history' }, { status: 500 })
    }
}
