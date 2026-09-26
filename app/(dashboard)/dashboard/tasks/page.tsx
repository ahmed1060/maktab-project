import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isValidTaskStatus } from "@/lib/valid-enums"
import TasksClient from "./TasksClient"
import { and, assignedToReportsWhere } from '@/lib/team-scope'
import { grantFor } from '@/lib/permissions/can'

export default async function TasksPage(props: { searchParams: Promise<{ company?: string, page?: string, status?: string, search?: string, employeeId?: string, teamLeaderId?: string, view?: string, dateFrom?: string, dateTo?: string }> }) {
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

    // An employee has one view, so a `view` in the query string is ignored for
    // them rather than honoured — the tabs below are a Team Leader's.
    //
    // How far this person sees others' tasks decides everything below: not at
    // all (their own only), their team's, their company's, or — for a Super
    // Admin — every company's.
    const scope = grantFor((session?.user ?? { role: null }) as any, 'tasks.view')
    const requestedView = searchParams.view || (scope === null || scope === 'TEAM' ? 'my' : 'active')
    const view = scope === null ? 'my' : requestedView
    const whereClause: any = {}
    const userCompanyId = (session?.user as any)?.companyId

    if (scope === null) {
        // An employee sees their own tasks and nothing else. The second view —
        // the company's other work in flight — is a Team Leader's, and it used
        // to answer here too: `?view=active` returned every colleague's open
        // task, with the whole row serialised into the page. `memberCosts` is a
        // per-person money map, so the payload carried what each of their
        // colleagues is paid per task, whether or not the screen drew it.
        //
        // Not gated on `view` at all, deliberately. Hiding the tab is a change
        // to the UI; this is the rule, and it holds for a typed URL, a
        // bookmarked one, or anything else that reaches this page.
        whereClause.companyId = userCompanyId
        and(whereClause, { assignees: { some: { id: userId } } })
    } else if (scope === 'TEAM') {
        whereClause.companyId = userCompanyId
        if (view === 'my') {
            and(whereClause, { assignees: { some: { id: userId } } })
        } else {
            // The team's work in flight. This used to read `none: { id: me }`
            // — everything in the company that was not the leader's own —
            // which grew with the company and had nothing to do with a team.
            and(whereClause, assignedToReportsWhere(userId))
        }
    } else if (scope === 'COMPANY') {
        // An Admin still sees all company tasks
        if (!userCompanyId) return <TasksClient tasks={[]} total={0} page={page} totalPages={0} role={role} currentUserId={userId} view={view} />
        whereClause.companyId = userCompanyId
    } else {
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
    if (searchParams.teamLeaderId) {
        // Same rule as the API's: at least one assignee on that team, and
        // `and` so it narrows whatever scope is already in place rather than
        // replacing it.
        and(whereClause, searchParams.teamLeaderId === 'unassigned'
            ? { assignees: { some: { teamLeaderId: null } } }
            : { assignees: { some: { teamLeaderId: searchParams.teamLeaderId } } })
    }
    if (searchParams.employeeId) {
        // `and`, not assignment. This line used to be
        // `whereClause.assignees = ...`, which replaced the scope set above
        // rather than narrowing it — so an employee reached any colleague's
        // tasks with ?employeeId= in the URL, and a team leader would have
        // reached any other team's. That is F-03 exactly, which was fixed once
        // in buildTaskWhereClause while this copy of the logic kept the bug.
        and(whereClause, { assignees: { some: { id: searchParams.employeeId } } })
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

    /**
     * memberCosts is a map of assignee id to what that person is paid for the
     * task. An employee's own entry is theirs to see — TaskListItem draws it as
     * "My Cost" — and the rest of the map is not.
     *
     * The list renders only `memberCosts[currentUserId]`, so nothing else was
     * ever on screen. It was in the HTML, though, which is the same disclosure
     * with an extra step: on a task with three assignees, any one of them could
     * read the other two's rate out of the page source. Narrowed here, at the
     * boundary, rather than trusting every present and future component that
     * receives this object to keep ignoring the rest.
     */
    function visibleMemberCosts(raw: any) {
        if (scope !== null || !raw) return raw
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (!parsed || typeof parsed !== 'object') return raw
        return userId in parsed ? { [userId]: parsed[userId] } : {}
    }

    // totalCost is a Prisma.Decimal (F-07) — Server Components can only pass
    // plain serializable values to Client Components.
    const serializedTasks = tasks.map((task: any) => ({
        ...task,
        totalCost: Number(task.totalCost),
        memberCosts: visibleMemberCosts(task.memberCosts),
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
