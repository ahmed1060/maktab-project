import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isValidTaskStatus } from "@/lib/valid-enums"
import TasksClient from "./TasksClient"

export default async function TasksPage(props: { searchParams: Promise<{ company?: string, page?: string, status?: string, search?: string, employeeId?: string, view?: string, dateFrom?: string, dateTo?: string }> }) {
    // Next 15 hands a page its dynamic segments and query string as
    // promises rather than plain objects, so they are awaited here and
    // the rest of the function reads them exactly as it did before.
    const searchParams = await props.searchParams

    const session = await getServerSession(authOptions)
    const role = (session?.user as any)?.role
    const page = parseInt(searchParams.page || '1')
    const limit = 10
    const skip = (page - 1) * limit
    const userId = (session?.user as any)?.id // Define userId here for all cases

    let companyId: string | undefined = undefined
    if (searchParams.company) {
        const comp = await prisma.company.findUnique({ where: { name: searchParams.company } })
        if (comp) companyId = comp.id
    }

    const view = searchParams.view || (['EMPLOYEE', 'TEAM_LEADER'].includes(role) ? 'my' : 'active')
    const whereClause: any = {}
    const userCompanyId = (session?.user as any)?.companyId

    if (role === 'EMPLOYEE') {
        whereClause.companyId = userCompanyId
        if (view === 'my') {
            whereClause.assignees = { some: { id: userId } }
        } else {
            // Active tasks: other users tasks in same company with status PENDING or IN_PROGRESS
            whereClause.assignees = { none: { id: userId } }
            whereClause.status = { in: ['PENDING', 'IN_PROGRESS'] }
        }
    } else if (role === 'TEAM_LEADER') {
        whereClause.companyId = userCompanyId
        if (view === 'my') {
            whereClause.assignees = { some: { id: userId } }
        } else {
            // Active tasks: all company tasks except those assigned to current user
            whereClause.assignees = { none: { id: userId } }
        }
    } else if (role === 'ADMIN') {
        // ADMIN still sees all company tasks
        if (!userCompanyId) return <TasksClient tasks={[]} total={0} page={page} totalPages={0} role={role} currentUserId={userId} view={view} />
        whereClause.companyId = userCompanyId
    } else if (role === 'SUPER_ADMIN') {
        // Super Admin can filter by company or see everything
        if (companyId) {
            whereClause.companyId = companyId
        }
    }

    // Apply Filters from searchParams
    if (searchParams.status) {
        // F-13: Task.status is a Postgres enum now — an invalid value would
        // make Postgres reject the whole query instead of the harmless
        // zero-match a plain String column gave a garbage filter value.
        whereClause.status = isValidTaskStatus(searchParams.status) ? searchParams.status : '__no_match__'
    }
    if (searchParams.search) {
        whereClause.title = { contains: searchParams.search, mode: 'insensitive' }
    }
    if (searchParams.employeeId) {
        whereClause.assignees = { some: { id: searchParams.employeeId } }
    }

    const { dateFrom, dateTo } = searchParams as any
    if (dateFrom || dateTo) {
        whereClause.updatedAt = {}
        if (dateFrom) whereClause.updatedAt.gte = new Date(dateFrom)
        if (dateTo) {
            const end = new Date(dateTo)
            end.setHours(23, 59, 59, 999)
            whereClause.updatedAt.lte = end
        }
    }

    const [tasks, total] = await Promise.all([
        (prisma.task as any).findMany({
            where: whereClause,
            include: {
                assignees: { select: { id: true, firstName: true, lastName: true } },
                creator: { select: { firstName: true, lastName: true } }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit
        }),
        (prisma.task as any).count({ where: whereClause })
    ])

    // totalCost is a Prisma.Decimal (F-07) — Server Components can only pass
    // plain serializable values to Client Components.
    const serializedTasks = tasks.map((task: any) => ({
        ...task,
        totalCost: Number(task.totalCost)
    }))

    return (
        <TasksClient
            tasks={serializedTasks}
            total={total}
            page={page}
            totalPages={Math.ceil(total / limit)}
            role={role}
            currentUserId={userId}
            view={view}
        />
    )
}
