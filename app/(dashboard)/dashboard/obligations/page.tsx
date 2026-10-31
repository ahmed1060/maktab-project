import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { accountRefusal } from "@/lib/account-refusal"
import AccessDenied from "@/components/AccessDenied"
import { prisma } from "@/lib/prisma"
import ObligationsClient from "./ObligationsClient"
import { assignedToTeamWhere, and } from "@/lib/team-scope"
import { grantFor } from "@/lib/permissions/can"
import { dayRangeIn } from "@/lib/services/filter-zone"
import { redirect } from "next/navigation"
import { askedPage, pageRedirect } from "@/lib/list-page"

export default async function ObligationsPage(props: { searchParams: Promise<{ company?: string, page?: string, status?: string, search?: string }> }) {
    // Next 15 hands a page its dynamic segments and query string as
    // promises rather than plain objects, so they are awaited here and
    // the rest of the function reads them exactly as it did before.
    const searchParams = await props.searchParams

    const session = await getServerSession(authOptions)
    // Refused as the APIs refuse it: suspended, archived, banned, lapsed or under
    // maintenance, before anything is read (found after PR 139).
    if (accountRefusal(session?.user ?? {})) return <AccessDenied />
    const { asked, page } = askedPage(searchParams.page)
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
    // The time an obligation is overdue by, so the page and the browser's
    // first render agree on which are. A Server Component renders once per
    // request, so there's no later render for the clock to disagree with.
    // eslint-disable-next-line react-hooks/purity -- server-rendered once per request
    const now = Date.now()

    if (scope === null) {
        whereClause.companyId = userCompanyId
        and(whereClause, { assignees: { some: { id: userId } } })
    } else if (scope === 'ALL') {
        if (companyId) {
            whereClause.companyId = companyId
        }
    } else {
        if (!userCompanyId) {
            return <ObligationsClient obligations={[]} total={0} page={1} totalPages={0} currentUserId={userId} now={now} />
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

    // Days where the company is, not on the server's clock.
    const updatedAt = await dayRangeIn(dateFrom, dateTo, whereClause.companyId)
    if (updatedAt) whereClause.updatedAt = updatedAt

    const [obligations, total] = await Promise.all([
        prisma.obligation.findMany({
            where: whereClause,
            // What the list shows, and nothing else of the row.
            select: {
                id: true, title: true, status: true, deadline: true, difficulty: true, recurrence: true,
                createdAt: true, updatedAt: true, lastStatusUpdateBy: true,
                assignees: { select: { id: true, firstName: true, lastName: true } },
            },
            orderBy: { deadline: 'asc' },
            skip,
            take: limit
        }),
        prisma.obligation.count({ where: whereClause })
    ])

    const totalPages = Math.ceil(total / limit)
    // A page past the last, as when its last obligation is deleted, goes to the last there is now.
    const elsewhere = pageRedirect('/dashboard/obligations', searchParams, asked, totalPages)
    if (elsewhere) redirect(elsewhere)

    return (
        <ObligationsClient
            obligations={obligations}
            total={total}
            page={page}
            totalPages={totalPages}
            currentUserId={userId}
            now={now}
        />
    )
}
