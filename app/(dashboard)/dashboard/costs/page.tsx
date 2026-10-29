import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import CostsClient from './CostsClient'
import { can } from '@/lib/permissions/can'
import { costNameOf, pendingCostsSnapshot, pendingCostsWhere } from '@/lib/services/costs-query'
import { costsDue, namedParts } from '@/lib/costs-total'
import { costNamed } from '@/lib/saved-lists'

export default async function CostsPage(props: { searchParams: Promise<{
        company?: string,
        page?: string,
        limit?: string,
        employeeId?: string,
        dateFrom?: string,
        dateTo?: string,
        search?: string,
        clientId?: string,
        locationId?: string,
        costNameId?: string
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
        return <CostsClient tasksWithCosts={[]} total={0} page={1} totalPages={0} totalDue={0} toPay={null} />
    }

    // A saved cost name (CLIENTS_PLAN.md §5.9): each task's costs of it, which
    // its cards and the total show, rather than every share.
    const named = searchParams.costNameId ? await costNameOf(session.user as any, searchParams) : null
    const namedCosts = named ? { costs: { where: costNamed(named), select: { authorId: true, amount: true } } } : {}

    // Fetch tasks and total count, and what every page of them still owes.
    const [tasksWithCosts, total, owed, ofName] = await Promise.all([
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
                },
                ...namedCosts,
            },
            orderBy: {
                updatedAt: 'desc'
            },
            skip,
            take: limit
        }),
        (prisma.task as any).count({ where }),
        // What Mark all as paid would pay, as it's confirmed (CLIENTS_PLAN.md §4.1):
        // with an employee picked, their shares, as the button pays then.
        pendingCostsSnapshot(where, searchParams.employeeId),
        // Every page's costs of the name, for the total.
        named ? prisma.task.findMany({ where, select: { id: true, memberCosts: true, memberPaymentStatus: true, ...namedCosts } }) : null,
    ])
    const totalDue = ofName
        ? Math.round(namedParts(ofName as any[], searchParams.employeeId).reduce((sum, p) => sum + p.amount, 0) * 100) / 100
        : costsDue(owed.rows, searchParams.employeeId)

    const totalPages = Math.ceil(total / limit)

    // totalCost is a Prisma.Decimal (F-07) — Server Components can only pass
    // plain serializable values to Client Components, so this has to become
    // a plain number here rather than downstream in CostsClient.
    const serializedTasks = tasksWithCosts.map((task: any) => ({
        ...task,
        totalCost: Number(task.totalCost),
        ...(task.costs ? { costs: task.costs.map((c: any) => ({ authorId: c.authorId, amount: Number(c.amount) })) } : {}),
    }))

    return (
        <CostsClient
            tasksWithCosts={serializedTasks}
           
            total={total}
            page={page}
            totalPages={totalPages}
            totalDue={totalDue}
            // Not with a cost name: a payment is a share of a task, not one of its costs (§5.9).
            toPay={searchParams.costNameId ? null : { count: owed.count, amount: owed.amount, digest: owed.digest }}
            costName={named?.name ?? null}
        />
    )
}
