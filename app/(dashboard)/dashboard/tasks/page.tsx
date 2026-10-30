import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isValidTaskStatus } from "@/lib/valid-enums"
import TasksClient from "./TasksClient"
import { and, assignedToReportsWhere, assignedToTeamWhere } from '@/lib/team-scope'
import { grantFor } from '@/lib/permissions/can'
import { shapeTask } from '@/lib/permissions/shape'
import { dayRangeIn } from '@/lib/services/filter-zone'
import { placeFilters } from '@/lib/place-filters'
import { titleNamed } from '@/lib/saved-lists'
import { ListService } from '@/lib/services/list.service'
import { redirect } from 'next/navigation'
import { askedPage, pageRedirect } from '@/lib/list-page'

export default async function TasksPage(props: { searchParams: Promise<{ company?: string, page?: string, status?: string, search?: string, employeeId?: string, teamLeaderId?: string, view?: string, dateFrom?: string, dateTo?: string, clientId?: string, locationId?: string, titleNameId?: string }> }) {
    // Next 15 hands a page its dynamic segments and query string as
    // promises rather than plain objects, so they are awaited here and
    // the rest of the function reads them exactly as it did before.
    const searchParams = await props.searchParams

    const session = await getServerSession(authOptions)
    const { asked, page } = askedPage(searchParams.page)
    const limit = 10
    const skip = (page - 1) * limit
    const userId = (session?.user as any)?.id // Define userId here for all cases
    // The time a task is overdue by, so the page and the browser's first
    // render agree on which are. A Server Component renders once per
    // request, so there's no later render for the clock to disagree with.
    // eslint-disable-next-line react-hooks/purity -- server-rendered once per request
    const now = Date.now()

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
        } else if (view === 'team') {
            // The team's tasks with the leader's own among them: what the
            // dashboard counts for a Team Leader, so its numbers' links land
            // on the tasks they counted. It has no tab of its own here.
            and(whereClause, assignedToTeamWhere(userId))
        } else {
            // The team's work in flight. This used to read `none: { id: me }`
            // — everything in the company that was not the leader's own —
            // which grew with the company and had nothing to do with a team.
            and(whereClause, assignedToReportsWhere(userId))
        }
    } else if (scope === 'COMPANY') {
        // An Admin still sees all company tasks
        if (!userCompanyId) return <TasksClient tasks={[]} total={0} page={1} totalPages={0} currentUserId={userId} view={view} now={now} />
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

    // Its client, or none, and where it's done (CLIENTS_PLAN.md §3).
    for (const narrower of placeFilters(searchParams.clientId, searchParams.locationId)) and(whereClause, narrower)
    // Picked as a saved title, or typed the same, in the company in view (§5.9).
    if (searchParams.titleNameId) {
        and(whereClause, titleNamed(await ListService.filterName('TASK_TITLE', searchParams.titleNameId, scope === 'ALL' ? companyId ?? null : userCompanyId ?? null)))
    }

    const { dateFrom, dateTo } = searchParams as any
    // Days where the company is, not on the server's clock.
    const updatedAt = await dayRangeIn(dateFrom, dateTo, whereClause.companyId)
    if (updatedAt) whereClause.updatedAt = updatedAt

    const [tasks, total] = await Promise.all([
        (prisma.task as any).findMany({
            where: whereClause,
            // What the list shows, and nothing else of the row.
            select: {
                id: true, title: true, status: true, deadline: true, difficulty: true,
                createdAt: true, updatedAt: true, lastStatusUpdateBy: true, memberCosts: true,
                assignees: { select: { id: true, firstName: true, lastName: true } },
                creator: { select: { firstName: true, lastName: true } },
                // Where it's done, the line under its title (DESIGN.md §5.4):
                // its location as it is now, or, from before locations, the
                // text it was given.
                client: { select: { name: true } },
                place: { select: { name: true, client: { select: { name: true } } } },
                location: true,
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit
        }),
        (prisma.task as any).count({ where: whereClause })
    ])

    const totalPages = Math.ceil(total / limit)
    // A page past the last, as when its last task is deleted, goes to the last there is now.
    const elsewhere = pageRedirect('/dashboard/tasks', searchParams, asked, totalPages)
    if (elsewhere) redirect(elsewhere)

    // Each task as this viewer may see it: someone without tasks.view — an
    // employee — gets only their own line of what each assignee is paid.
    // memberCosts used to be serialised whole, so on a shared task any one
    // assignee could read the others' rates out of the page source.
    const viewer = (session?.user ?? { role: null }) as any
    function visibleMemberCosts(raw: any) {
        return shapeTask(viewer, { memberCosts: raw }).memberCosts
    }

    const serializedTasks = tasks.map((task: any) => ({
        ...task,
        memberCosts: visibleMemberCosts(task.memberCosts),
    }))

    return (
        <TasksClient
            tasks={serializedTasks}
            total={total}
            page={page}
            totalPages={totalPages}
            currentUserId={userId}
            view={view}
            now={now}
        />
    )
}
