import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import CostsClient from './CostsClient'

export default async function CostsPage({ searchParams }: { searchParams: { company?: string } }) {
    const session = await getServerSession(authOptions)
    if (!session) {
        redirect('/login')
    }

    const userRole = (session.user as any)?.role

    // Only allow ADMIN, SUPER_ADMIN, TEAM_LEADER
    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        redirect('/dashboard')
    }

    let companyId: string | undefined = undefined
    if (searchParams.company) {
        const comp = await prisma.company.findUnique({ where: { name: searchParams.company } })
        if (comp) companyId = comp.id
    }

    // Determine strict company filter for non-Super Admins
    const userCompanyId = (session.user as any).companyId
    let finalCompanyId = companyId

    if (userRole !== 'SUPER_ADMIN') {
        if (!userCompanyId) {
            return <CostsClient tasksWithCosts={[]} userRole={userRole} />
        }
        finalCompanyId = userCompanyId
    }

    // Fetch all approved/completed tasks with totalCost > 0 and PENDING_PAYMENT status
    const tasksWithCosts = await (prisma.task as any).findMany({
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
                },
                ...(finalCompanyId ? [{ assignee: { companyId: finalCompanyId } }] : [])
            ]
        },
        select: {
            id: true,
            title: true,
            totalCost: true,
            memberCosts: true,
            status: true,
            updatedAt: true,
            assignee: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true
                }
            },
            assignees: {
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
