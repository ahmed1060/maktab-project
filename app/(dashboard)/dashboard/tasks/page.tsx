import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import TasksClient from "./TasksClient"

export default async function TasksPage({ searchParams }: { searchParams: { company?: string, page?: string, status?: string, search?: string, employeeId?: string, view?: string, dateFrom?: string, dateTo?: string } }) {
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
        if (view === 'my') {
            whereClause.OR = [
                { assigneeId: userId },
                { assignees: { some: { id: userId } } }
            ]
        } else {
            // Active tasks: other users tasks in same company with status PENDING or IN_PROGRESS
            whereClause.assignee = { companyId: userCompanyId }
            whereClause.NOT = [
                { assigneeId: userId },
                { assignees: { some: { id: userId } } }
            ]
            whereClause.status = { in: ['PENDING', 'IN_PROGRESS'] }
        }
    } else if (role === 'TEAM_LEADER') {
        if (view === 'my') {
            whereClause.OR = [
                { assigneeId: userId },
                { assignees: { some: { id: userId } } }
            ]
        } else {
            // Active tasks: all company tasks except those assigned to current user
            whereClause.assignee = { companyId: userCompanyId }
            whereClause.NOT = [
                { assigneeId: userId },
                { assignees: { some: { id: userId } } }
            ]
        }
    } else if (role === 'ADMIN') {
        // ADMIN still sees all company tasks
        if (!userCompanyId) return <TasksClient tasks={[]} total={0} page={page} totalPages={0} role={role} currentUserId={userId} view={view} />
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
            currentUserId={userId}
            view={view}
        />
    )
}
