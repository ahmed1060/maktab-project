import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import CostsClient from './CostsClient'
import { can, grantFor } from '@/lib/permissions/can'
import { assignedToTeamWhere } from '@/lib/team-scope'

export default async function CostsPage(props: { searchParams: Promise<{
        company?: string,
        page?: string,
        limit?: string,
        employeeId?: string,
        dateFrom?: string,
        dateTo?: string,
        search?: string
    }> }) {
    // Next 15 hands a page its dynamic segments and query string as
    // promises rather than plain objects, so they are awaited here and
    // the rest of the function reads them exactly as it did before.
    const searchParams = await props.searchParams

    const session = await getServerSession(authOptions)
    if (!session) {
        redirect('/login')
    }

    const userRole = (session.user as any)?.role

    // The page is for paying task costs: those who hold tasks.pay.
    if (!can(session.user as any, 'tasks.pay')) {
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

    // A Team Leader pays their team's tasks — tasks.pay at TEAM scope, the rule
    // every task route applies through verifyResourceAccess — so this page
    // lists those, not every pending payment in the company. It listed the
    // company's, which put what colleagues outside the team are owed in front
    // of a leader who could not act on most of it.
    if (grantFor(session.user as any, 'tasks.pay') === 'TEAM') {
        where.AND.push(assignedToTeamWhere((session.user as any).id))
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

    // totalCost is a Prisma.Decimal (F-07) — Server Components can only pass
    // plain serializable values to Client Components, so this has to become
    // a plain number here rather than downstream in CostsClient.
    const serializedTasks = tasksWithCosts.map((task: any) => ({
        ...task,
        totalCost: Number(task.totalCost)
    }))

    return (
        <CostsClient
            tasksWithCosts={serializedTasks}
            userRole={userRole}
            total={total}
            page={page}
            totalPages={totalPages}
        />
    )
}
