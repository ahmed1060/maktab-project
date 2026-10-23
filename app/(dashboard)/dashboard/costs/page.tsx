import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import CostsClient from './CostsClient'
import { can } from '@/lib/permissions/can'
import { pendingCostsWhere } from '@/lib/services/costs-query'

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

    // The page is for paying task costs: those who hold tasks.pay.
    if (!can(session.user as any, 'tasks.pay')) {
        redirect('/dashboard')
    }

    const page = parseInt(searchParams.page || '1')
    const limit = parseInt(searchParams.limit || '10')
    const skip = (page - 1) * limit

    // The same query "Mark all as paid" runs, so it pays the list shown.
    const where = await pendingCostsWhere(session.user as any, searchParams)
    if (!where) {
        return <CostsClient tasksWithCosts={[]} total={0} page={1} totalPages={0} />
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
           
            total={total}
            page={page}
            totalPages={totalPages}
        />
    )
}
