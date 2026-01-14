import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import TasksClient from "./TasksClient"

export default async function TasksPage({ searchParams }: { searchParams: { company?: string, page?: string, status?: string, search?: string, employeeId?: string } }) {
    const session = await getServerSession(authOptions)
    const role = (session?.user as any)?.role
    const page = parseInt(searchParams.page || '1')
    const limit = 10
    const skip = (page - 1) * limit

    let companyId: string | undefined = undefined
    if (searchParams.company) {
        const comp = await prisma.company.findUnique({ where: { name: searchParams.company } })
        if (comp) companyId = comp.id
    }

    const whereClause: any = {}
    const userCompanyId = (session?.user as any)?.companyId

    if (role === 'EMPLOYEE') {
        const userId = (session?.user as any)?.id
        whereClause.OR = [
            { assigneeId: userId },
            { assignees: { some: { id: userId } } }
        ]
    } else if (['ADMIN', 'TEAM_LEADER'].includes(role)) {
        // Strict isolation for Admin/Team Leader: Must match their company
        if (!userCompanyId) {
            // Unassigned Admins see nothing
            return <TasksClient tasks={[]} total={0} page={1} totalPages={0} role={role} currentUserId={(session?.user as any)?.id} />
        }
        whereClause.assignee = { companyId: userCompanyId }
    } else if (role === 'SUPER_ADMIN') {
        // Super Admin can filter by company or see everything
        if (companyId) {
            whereClause.assignee = { companyId }
        }
    }

    // Apply Filters from searchParams
    if (searchParams.status) {
        whereClause.status = searchParams.status
    }
    if (searchParams.search) {
        whereClause.title = { contains: searchParams.search, mode: 'insensitive' }
    }
    if (searchParams.employeeId) {
        const employeeMatch = {
            OR: [
                { assigneeId: searchParams.employeeId },
                { assignees: { some: { id: searchParams.employeeId } } }
            ]
        }
        if (whereClause.OR) {
            whereClause.AND = [{ OR: whereClause.OR }, employeeMatch]
            delete whereClause.OR
        } else {
            whereClause.AND = whereClause.AND || []
            whereClause.AND.push(employeeMatch)
        }
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
                assignee: { select: { firstName: true, lastName: true } },
                assignees: { select: { id: true, firstName: true, lastName: true } },
                creator: { select: { firstName: true, lastName: true } }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit
        }),
        (prisma.task as any).count({ where: whereClause })
    ])

    return (
        <TasksClient
            tasks={tasks}
            total={total}
            page={page}
            totalPages={Math.ceil(total / limit)}
            role={role}
            currentUserId={(session?.user as any)?.id}
        />
    )
}
