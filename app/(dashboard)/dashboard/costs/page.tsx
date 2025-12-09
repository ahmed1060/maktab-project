import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import CostsClient from './CostsClient'

export default async function CostsPage() {
    const session = await getServerSession(authOptions)
    if (!session) {
        redirect('/login')
    }

    const userRole = (session.user as any)?.role

    // Only allow ADMIN, SUPER_ADMIN, TEAM_LEADER
    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        redirect('/dashboard')
    }

    // Fetch all approved/completed tasks with totalCost > 0 and PENDING_PAYMENT status
    const tasksWithCosts = await prisma.task.findMany({
        where: {
            AND: [
                {
                    OR: [
                        { status: 'APPROVED' },
                        { status: 'COMPLETED' },
                        { status: 'REJECTED' }
                    ]
                },
                {
                    totalCost: {
                        gt: 0
                    }
                },
                {
                    paymentStatus: 'PENDING_PAYMENT'
                }
            ]
        },
        select: {
            id: true,
            title: true,
            totalCost: true,
            status: true,
            updatedAt: true,
            assignee: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true
                }
            }
        },
        orderBy: {
            updatedAt: 'desc'
        }
    })

    return <CostsClient tasksWithCosts={tasksWithCosts} userRole={userRole} />
}
