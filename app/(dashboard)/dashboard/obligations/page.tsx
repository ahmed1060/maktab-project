import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import ObligationsClient from "./ObligationsClient"

export default async function ObligationsPage({ searchParams }: { searchParams: { company?: string, page?: string, status?: string, search?: string } }) {
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
        whereClause.assigneeId = (session?.user as any)?.id
    } else if (['ADMIN', 'TEAM_LEADER'].includes(role)) {
        if (!userCompanyId) {
            return <ObligationsClient obligations={[]} total={0} page={1} totalPages={0} role={role} />
        }
        whereClause.assignee = { companyId: userCompanyId }
    } else if (role === 'SUPER_ADMIN') {
        if (companyId) {
            whereClause.assignee = { companyId }
        }
    }

    // Apply Filters from searchParams
    const { status, search, employeeId, dateFrom, dateTo } = searchParams as any

    if (status) {
        whereClause.status = status
    }
    if (search) {
        whereClause.title = { contains: search, mode: 'insensitive' }
    }
    if (employeeId && role !== 'EMPLOYEE') {
        whereClause.assigneeId = employeeId
    }

    if (dateFrom || dateTo) {
        whereClause.updatedAt = {}
        if (dateFrom) whereClause.updatedAt.gte = new Date(dateFrom)
        if (dateTo) {
            const end = new Date(dateTo)
            end.setHours(23, 59, 59, 999)
            whereClause.updatedAt.lte = end
        }
    }

    const [obligations, total] = await Promise.all([
        prisma.obligation.findMany({
            where: whereClause,
            include: { assignee: { select: { firstName: true, lastName: true } } },
            orderBy: { deadline: 'asc' },
            skip,
            take: limit
        }),
        prisma.obligation.count({ where: whereClause })
    ])

    return (
        <ObligationsClient
            obligations={obligations}
            total={total}
            page={page}
            totalPages={Math.ceil(total / limit)}
            role={role}
        />
    )
}
