import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import ObligationsClient from "./ObligationsClient"
import { assignedToTeamWhere, and } from "@/lib/team-scope"
import { grantFor } from "@/lib/permissions/can"

export default async function ObligationsPage(props: { searchParams: Promise<{ company?: string, page?: string, status?: string, search?: string }> }) {
    // Next 15 hands a page its dynamic segments and query string as
    // promises rather than plain objects, so they are awaited here and
    // the rest of the function reads them exactly as it did before.
    const searchParams = await props.searchParams

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

    // What this person may see of the company's obligations: nothing beyond
    // their own without obligations.view, their team's at TEAM scope, the
    // company's at COMPANY, everything for a Super Admin.
    const scope = grantFor(session?.user as any, 'obligations.view')
    const userId = (session?.user as any)?.id

    if (scope === null) {
        whereClause.companyId = userCompanyId
        and(whereClause, { assignees: { some: { id: userId } } })
    } else if (scope === 'ALL') {
        if (companyId) {
            whereClause.companyId = companyId
        }
    } else {
        if (!userCompanyId) {
            return <ObligationsClient obligations={[]} total={0} page={1} totalPages={0} role={role} />
        }
        whereClause.companyId = userCompanyId
        // A Team Leader sees their team's obligations — the rule
        // GET /api/obligations and the obligation page already apply. This
        // list used to be the one place a leader saw the whole company's,
        // and opening any of those outside the team was refused.
        if (scope === 'TEAM') and(whereClause, assignedToTeamWhere(userId))
    }

    // Apply Filters from searchParams
    const { status, search, employeeId, dateFrom, dateTo } = searchParams as any

    if (status) {
        whereClause.status = status
    }
    if (search) {
        whereClause.title = { contains: search, mode: 'insensitive' }
    }
    if (employeeId && scope !== null) {
        // Composed, not assigned: a filter narrows the scope above, it never
        // replaces it.
        and(whereClause, { assignees: { some: { id: employeeId } } })
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
            include: { assignees: { select: { firstName: true, lastName: true } } },
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
