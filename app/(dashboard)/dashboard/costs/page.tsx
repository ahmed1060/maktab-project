import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import CostsClient from './CostsClient'

export default async function CostsPage({
    searchParams
}: {
    searchParams: {
        company?: string,
        page?: string,
        limit?: string,
        employeeId?: string,
        dateFrom?: string,
        dateTo?: string,
        search?: string
    }
}) {
    const session = await getServerSession(authOptions)
    if (!session) {
        redirect('/login')
    }

    const userRole = (session.user as any)?.role

    // Only allow ADMIN, SUPER_ADMIN, TEAM_LEADER
    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        redirect('/dashboard')
    }

    const page = parseInt(searchParams.page || '1')
    const limit = parseInt(searchParams.limit || '10')
    const skip = (page - 1) * limit

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
            return <CostsClient tasksWithCosts={[]} userRole={userRole} total={0} page={1} totalPages={0} />
        }
        finalCompanyId = userCompanyId
    }

    // Build Where Clause
    const where: any = {
        AND: [
            {
                OR: [
                    { status: 'APPROVED' },
                    { status: 'COMPLETED' },
                    { status: 'REJECTED' }
                ]
            },
            {
                totalCost: { gt: 0 }
            },
            {
                paymentStatus: 'PENDING_PAYMENT'
            }
        ]
    }

    if (finalCompanyId) {
        where.AND.push({
            assignees: { some: { companyId: finalCompanyId } }
        })
    }

    if (searchParams.employeeId) {
        where.AND.push({
            assignees: { some: { id: searchParams.employeeId } }
        })
    }

    if (searchParams.search) {
        where.AND.push({
            title: { contains: searchParams.search, mode: 'insensitive' }
        })
    }

    if (searchParams.dateFrom) {
        where.AND.push({ updatedAt: { gte: new Date(searchParams.dateFrom) } })
    }

    if (searchParams.dateTo) {
        const toDate = new Date(searchParams.dateTo)
        toDate.setHours(23, 59, 59, 999)
        where.AND.push({ updatedAt: { lte: toDate } })
    }

    // Fetch tasks and total count
    const [tasksWithCosts, total] = await Promise.all([
        (prisma.task as any).findMany({
            where,
            select: {
                id: true,
                title: true,
                totalCost: true,
                memberCosts: true,
                memberPaymentStatus: true,
                status: true,
                updatedAt: true,
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
            },
            skip,
            take: limit
        }),
        (prisma.task as any).count({ where })
    ])

    const totalPages = Math.ceil(total / limit)

    return (
        <CostsClient
            tasksWithCosts={tasksWithCosts}
            userRole={userRole}
            total={total}
            page={page}
            totalPages={totalPages}
        />
    )
}
