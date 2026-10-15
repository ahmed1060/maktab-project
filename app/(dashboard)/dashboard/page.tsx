import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
    BuildingsIcon, CalendarBlankIcon, CheckCircleIcon, ClipboardTextIcon, PlusIcon, UserPlusIcon, UsersIcon,
} from "@phosphor-icons/react/ssr"
import {
    ButtonLink, Columns, DonutChart, DueDate, EmptyState, Page, PageHeader, Panel, Row, Rows, Section, SectionLink, StatusBadge,
    TotalTiles, taskStatusTone,
} from "@/components/ui"
import { countOf } from "@/lib/plural"
import { usedDayOffCredit } from "@/lib/day-off-credit"
import { tasksListHref } from "./tasks/list-href"
import { cookies, headers } from "next/headers"
import type { TranslationKey } from "@/lib/translations"
import { resolveLocale } from "@/lib/locale"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"
import { getSuperAdminOverviewStats } from "@/lib/services/dashboard-stats.service"
import { modulesFrom } from "@/lib/modules"
import { SCOPED_COMPANY_COOKIE, scopedCompanyId } from "@/lib/company-scope"
import { CompanyService } from "@/lib/services/company.service"
import { scopesToTeam, assignedToTeamWhere, teamMemberWhere, and } from '@/lib/team-scope'
import { can, grantFor } from '@/lib/permissions/can'

export const dynamic = 'force-dynamic'

/** Every task status, in the order a task moves through them. */
const TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED'] as const

export default async function DashboardPage(props: { searchParams: Promise<{ company?: string }> }) {
    // Next 15 hands a page its dynamic segments and query string as
    // promises rather than plain objects, so they are awaited here and
    // the rest of the function reads them exactly as it did before.
    const searchParams = await props.searchParams

    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role
    // Who is asking, for can(): nobody signed in holds nothing.
    const viewer = (session?.user ?? { role: null }) as any
    const userId = (session?.user as any)?.id
    // A Team Leader's task numbers are their team's; their links say so.
    const tasksTeamOnly = grantFor(viewer, 'tasks.view') === 'TEAM'

    // Server-side localization
    // Awaited since Next 15: cookies(), headers() and draftMode() are async,
    // because a request's store is now resolved when it is asked for rather
    // than assumed to be already there.
    const cookieStore = await cookies()
    const locale = resolveLocale(cookieStore.get('NEXT_LOCALE')?.value, (await headers()).get('accept-language'))
    const dict = locale === 'ar' ? ar : en
    const t = (key: TranslationKey) => dict[key] || en[key]

    // This company's names and icons for its modules. Resolved exactly the way
    // the dashboard layout resolves the sidebar's — same cookie, same role
    // check, same loader — so a heading here and its sidebar entry cannot end
    // up describing different companies. Falls through to the session for
    // everyone who is not a Super Admin scoped to one company.
    const scopeId = scopedCompanyId(userRole, cookieStore.get(SCOPED_COMPANY_COOKIE)?.value)
    const scopedBranding = scopeId ? await CompanyService.getBranding(scopeId) : null
    const modules = modulesFrom(scopedBranding ?? session?.user, t)

    // Numbers, dates and counts in the page's language (DESIGN.md §3.3, §7).
    const numLocale = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const num = (n: number) => n.toLocaleString(numLocale)
    const day = (d: Date | string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
        new Date(d).toLocaleDateString(numLocale, opts)
    const days = (n: number) => countOf(t, locale, n, 'days')
    const share = (part: number, whole: number) =>
        t('ui_completed_share').replace('{share}', new Intl.NumberFormat(numLocale, { style: 'percent' }).format(whole > 0 ? part / whole : 0))
    const statusWord = (status: string) => t(`status_${status.toLowerCase()}` as TranslationKey)
    const badge = (status: string) => <StatusBadge tone={taskStatusTone(status)}>{statusWord(status)}</StatusBadge>
    // Tasks by status as a donut: every status, in the order a task moves
    // through them, each with its word and count, linking to those tasks.
    const byStatus = (counts: { status: string; _count: number }[], label: string) => {
        const count = (status: string) => counts.find(c => c.status === status)?._count ?? 0
        return (
            <DonutChart
                label={label}
                parts={TASK_STATUSES.map(status => ({
                    key: status,
                    label: statusWord(status),
                    value: count(status),
                    count: num(count(status)),
                    tone: taskStatusTone(status),
                    href: tasksListHref({ status, teamOnly: tasksTeamOnly }),
                }))}
                total={num(counts.reduce((acc, c) => acc + c._count, 0))}
                totalLabel={t('total_label')}
                emptyLabel={t('no_data_available')}
            />
        )
    }

    let companyId: string | undefined = undefined
    if (searchParams.company) {
        const comp = await prisma.company.findUnique({ where: { name: searchParams.company } })
        if (comp) companyId = comp.id
    }

    const currentMonth = new Date().getMonth() + 1
    const currentYear = new Date().getFullYear()

    // The overview is for whoever sees others' tasks — company-wide or, for a
    // Team Leader, their team's. Everyone else gets their own dashboard below.
    if (can(viewer, 'tasks.view')) {
        // Super Admin System Overview (when no specific company is selected)
        if (userRole === 'SUPER_ADMIN' && !companyId) {
            // "Needs Attention" — the things a super admin would otherwise
            // only find by opening each page individually. Recomputed here
            // (not read from the cached stats below) only for the audit-log
            // link's date boundary — a few seconds' difference from the
            // cached query's own internal snapshot doesn't matter for that.
            // A Server Component: this renders once per request and never
            // again, so there is no later render for the clock to disagree
            // with — which is what the purity rule guards against, and why it
            // is a client-component rule that has no way to know this file
            // runs on the server.
            // eslint-disable-next-line react-hooks/purity -- server-rendered once per request
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

            // Cached 30s — this is the same read for every super admin
            // regardless of who's looking, unlike the company/employee views
            // below which stay uncached since people expect those to reflect
            // their own just-taken action immediately. See
            // lib/services/dashboard-stats.service.ts for why.
            const { totalCompanies, totalUsers, totalTasks, totalClients, taskStats, systemErrors24h, expiringSubscriptions, bannedCompanies } = await getSuperAdminOverviewStats()

            return (
                <Page>
                    <PageHeader
                        title={t('system_overview')}
                        subtitle={t('dashboard_subtitle' as any)}
                        action={<>
                            <ButtonLink href="/dashboard/companies" variant="primary" icon={BuildingsIcon}>{t('manage_companies')}</ButtonLink>
                            <ButtonLink href="/dashboard/all-users" icon={UsersIcon}>{t('view_all_users')}</ButtonLink>
                        </>}
                    />

                    <TotalTiles items={[
                        { label: t('total_companies'), value: num(totalCompanies), href: '/dashboard/companies' },
                        { label: t('total_users'), value: num(totalUsers), href: '/dashboard/all-users' },
                        { label: t('total_tasks'), value: num(totalTasks) },
                        { label: t('business_clients'), value: num(totalClients) },
                    ]} />

                    <Columns>
                        <Section title={t('needs_attention')}>
                            <TotalTiles items={[
                                { label: t('system_errors_24h'), value: num(systemErrors24h), href: `/dashboard/audit-logs?action=SYSTEM_API_ERROR&startDate=${encodeURIComponent(oneDayAgo.toISOString())}` },
                                { label: t('expiring_subscriptions'), value: num(expiringSubscriptions), href: '/dashboard/companies' },
                                { label: t('banned_companies'), value: num(bannedCompanies), href: '/dashboard/companies' },
                            ]} />
                        </Section>
                        <Section title={t('global_task_status')}>
                            {byStatus(taskStats as any, t('global_task_status'))}
                        </Section>
                    </Columns>
                </Page>
            )
        }

        // Regular Admin/Team Leader view
        const userCompanyId = (session?.user as any).companyId

        // Determine final company ID: Non-super admins are FORCED to their own company
        const finalCompanyId = userRole === 'SUPER_ADMIN' ? companyId : userCompanyId

        // If a non-super admin has no company, they see nothing
        if (userRole !== 'SUPER_ADMIN' && !userCompanyId) {
            // Return early or show empty dashboard
            return (
                <Page>
                    <PageHeader title={t('unauthorized')} />
                    <Panel>
                        <EmptyState icon={BuildingsIcon} title={t('no_company_assigned')} />
                    </Panel>
                </Page>
            )
        }

        // The counters a Team Leader sees are their team's, not the company's.
        // The card above them has always been titled "Team Performance" for
        // this role — the label was a promise the query did not keep, and the
        // numbers would otherwise disagree with the lists underneath them.
        const baseWhere: any = finalCompanyId ? { companyId: finalCompanyId } : {}
        if (scopesToTeam(viewer, 'tasks.view')) and(baseWhere, assignedToTeamWhere(userId))

        // "Needs Your Review" — approval queues this person can act on: each
        // count is asked of the permission its approval route checks. A Team
        // Leader holds neither, so sees only task reviews. A Super Admin
        // looking at one company holds both, and now sees that company's
        // queues too — they used to be left out by a check that named ADMIN.
        // Below runs everything together instead of as 4-5 sequential
        // round trips: taskStats/salaryStats/overdueTasks never depended on
        // each other, and the two counts it may not act on just resolve to 0
        // instead of skipping the query entirely when the role doesn't
        // apply, so the whole page can still await one Promise.all.
        const [taskStats, salaryStats, overdueTasks, pendingDayOffRequests, pendingProfileRequests] = await Promise.all([
            // Optimized status counts using groupBy
            prisma.task.groupBy({
                where: baseWhere,
                by: ['status'],
                _count: true
            }),
            // Salary aggregates for the company
            prisma.salaryRecord.aggregate({
                where: {
                    month: currentMonth,
                    year: currentYear,
                    user: scopesToTeam(viewer, 'tasks.view')
                        ? { companyId: finalCompanyId, ...teamMemberWhere(userId) }
                        : (finalCompanyId ? { companyId: finalCompanyId } : {})
                },
                _sum: {
                    bonusDays: true,
                    deductions: true
                }
            }),
            // Overdue: past deadline, not in a final state — same idea as the
            // employee "due today" list, but for this admin's whole team.
            prisma.task.findMany({
                where: { ...baseWhere, deadline: { lt: new Date() }, status: { notIn: ['COMPLETED', 'APPROVED'] } },
                orderBy: { deadline: 'asc' },
                take: 5,
                select: { id: true, title: true, deadline: true, status: true }
            }),
            can(viewer, 'dayoff.approve')
                ? prisma.dayOffRequest.count({ where: { status: 'PENDING', user: { companyId: finalCompanyId } } })
                : Promise.resolve(0),
            can(viewer, 'profile_requests.review')
                ? prisma.profileUpdateRequest.count({ where: { status: 'PENDING', user: { companyId: finalCompanyId } } })
                : Promise.resolve(0)
        ])

        const totalTasks = taskStats.reduce((acc, s) => acc + s._count, 0)
        const completedTasks = taskStats.find(s => s.status === 'COMPLETED')?._count || 0
        const reviewTasks = taskStats.find(s => s.status === 'PENDING_CONFIRMATION')?._count || 0


        return (
            <Page>
                <PageHeader
                    title={tasksTeamOnly ? t('team_performance') : t('admin_overview')}
                    subtitle={t('dashboard_subtitle' as any)}
                    action={<>
                        <ButtonLink href="/dashboard/tasks/new" variant="primary" icon={PlusIcon}>{t('create_new_task')}</ButtonLink>
                        {can(viewer, 'employees.create') && <ButtonLink href="/dashboard/employees/new" icon={UserPlusIcon}>{t('add_employee')}</ButtonLink>}
                    </>}
                />

                <TotalTiles items={[
                    { label: t('task_completion'), value: `${num(completedTasks)}/${num(totalTasks)}`, note: share(completedTasks, totalTasks), href: tasksListHref({ teamOnly: tasksTeamOnly }) },
                    { label: t('team_bonuses'), value: days(Number(salaryStats._sum.bonusDays || 0)), note: t('total_this_month') },
                    { label: t('team_deductions'), value: days(Number(salaryStats._sum.deductions || 0)), note: t('total_this_month') },
                ]} />

                <Section title={t('needs_your_review')}>
                    <TotalTiles items={[
                        { label: t('pending_task_reviews'), value: num(reviewTasks), href: tasksListHref({ status: 'PENDING_CONFIRMATION', teamOnly: tasksTeamOnly }) },
                        ...(can(viewer, 'dayoff.approve') ? [{ label: t('pending_day_off_requests'), value: num(pendingDayOffRequests), href: '/dashboard/day-off-requests?status=PENDING' }] : []),
                        ...(can(viewer, 'profile_requests.review') ? [{ label: t('pending_profile_requests'), value: num(pendingProfileRequests), href: '/dashboard/profile-requests' }] : []),
                    ]} />
                </Section>

                <Columns>
                    <Section title={t('overdue_tasks')}>
                        {overdueTasks.length === 0 ? (
                            <Panel><EmptyState icon={CheckCircleIcon} title={t('no_overdue_tasks')} /></Panel>
                        ) : (
                            <Rows label={t('overdue_tasks')}>
                                {overdueTasks.map(task => (
                                    <Row
                                        key={task.id}
                                        href={`/dashboard/tasks/${task.id}`}
                                        title={task.title}
                                        tone="overdue"
                                        end={<DueDate overdue>{day(task.deadline)}</DueDate>}
                                    />
                                ))}
                            </Rows>
                        )}
                    </Section>
                    <Section title={t('team_workload')}>
                        {byStatus(taskStats as any, t('team_workload'))}
                    </Section>
                </Columns>
            </Page>
        )
    } else {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const tomorrow = new Date(today)
        tomorrow.setDate(tomorrow.getDate() + 1)
        const weekFromNow = new Date(today)
        weekFromNow.setDate(weekFromNow.getDate() + 7)

        // Optimized Employee View: Use groupBy for stats and targeted fetch
        // for today's focus. All of these are independent of each other —
        // previously fired as sequential awaits, so this page paid for a
        // separate round trip to Postgres for each before it could render.
        // Running them together costs one round trip's worth of latency.
        const [taskStats, currentUser, salaryRecord, myObligations, myLatestDayOffRequest, upcomingTasks] = await Promise.all([
            prisma.task.groupBy({
                where: {
                    assignees: { some: { id: userId } }
                },
                by: ['status'],
                _count: true
            }),
            // The credit left and the year's allowance, for "used".
            prisma.user.findUnique({
                where: { id: userId },
                select: { dayOffCredit: true, baseDayOffCredit: true }
            }),
            // Salary record for current month
            prisma.salaryRecord.findUnique({
                where: {
                    userId_month_year: {
                        userId: userId,
                        month: currentMonth,
                        year: currentYear
                    }
                }
            }),
            prisma.obligation.findMany({
                where: {
                    assignees: { some: { id: userId } }
                },
                orderBy: { deadline: 'asc' },
                take: 5
            }),
            // My latest day-off request — otherwise the only way to see where
            // a request stands is opening the requests page.
            prisma.dayOffRequest.findFirst({
                where: { userId },
                orderBy: { createdAt: 'desc' }
            }),
            // Widened from "due today" to "due this week" — a same-day-only
            // view means this section is empty most days.
            prisma.task.findMany({
                where: {
                    assignees: { some: { id: userId } },
                    deadline: {
                        gte: today,
                        lt: weekFromNow
                    },
                    status: { notIn: ['COMPLETED', 'APPROVED'] }
                },
                orderBy: { deadline: 'asc' },
                include: {
                    assignees: { select: { id: true, firstName: true, lastName: true } }
                }
            })
        ])

        const totalTasks = taskStats.reduce((acc, s) => acc + s._count, 0)
        const completedTasks = taskStats.find(s => s.status === 'COMPLETED')?._count || 0
        const remainingCredit = currentUser?.dayOffCredit || 0
        const usedCredits = usedDayOffCredit(currentUser?.baseDayOffCredit, currentUser?.dayOffCredit)
        const dayOffWord = (type: string) => t(`${type.toLowerCase()}_day_off` as TranslationKey)
        const dayOffTone = (status: string) => status === 'APPROVED' ? 'good' : status === 'REJECTED' ? 'problem' : 'neutral'

        return (
            <Page>
                <PageHeader title={t('hello_name').replace('{name}', (session?.user as any)?.firstName ?? '')} subtitle={t('dashboard_subtitle' as any)} />

                <TotalTiles items={[
                    { label: t('overall_progress'), value: `${num(completedTasks)}/${num(totalTasks)}`, note: share(completedTasks, totalTasks), href: tasksListHref({ teamOnly: tasksTeamOnly }) },
                    { label: t('bonus'), value: days(Number(salaryRecord?.bonusDays || 0)), note: t('extra_earnings') },
                    { label: t('payroll_deductions'), value: days(Number(salaryRecord?.deductions || 0)), note: t('total_lost_days') },
                ]} />

                <Columns>
                    <Section title={t('task_distribution')}>
                        {byStatus(taskStats as any, t('task_distribution'))}
                    </Section>
                    <Section title={t('credit_overview')}>
                        <DonutChart
                            label={t('credit_overview')}
                            parts={[
                                { key: 'left', label: t('remaining_credit'), value: remainingCredit, count: days(remainingCredit), tone: 'good', href: '/dashboard/day-off-requests' },
                                { key: 'used', label: t('used_credit'), value: usedCredits, count: days(usedCredits), tone: 'neutral', href: '/dashboard/day-off-requests' },
                            ]}
                            total={days(remainingCredit + usedCredits)}
                            totalLabel={t('total_label')}
                            emptyLabel={t('no_data_available')}
                        />
                    </Section>
                </Columns>

                <Section title={t('due_this_week')} action={<SectionLink href="/dashboard/tasks">{t('view_all')}</SectionLink>}>
                    {upcomingTasks.length === 0 ? (
                        <Panel><EmptyState icon={CheckCircleIcon} title={t('no_pending_tasks_week')} /></Panel>
                    ) : (
                        <Rows label={t('due_this_week')}>
                            {upcomingTasks.map((task: any) => (
                                <Row
                                    key={task.id}
                                    href={`/dashboard/tasks/${task.id}`}
                                    title={task.title}
                                    detail={countOf(t, locale, task.difficulty ?? 0, 'pts')}
                                    end={<>
                                        {badge(task.status)}
                                        <DueDate>{new Date(task.deadline) < tomorrow ? t('today') : day(task.deadline, { weekday: 'short', day: 'numeric', month: 'short' })}</DueDate>
                                    </>}
                                />
                            ))}
                        </Rows>
                    )}
                </Section>

                <Columns>
                    {myLatestDayOffRequest && (
                        <Section title={t('my_day_off_request')} action={<SectionLink href="/dashboard/day-off-requests">{t('view_all')}</SectionLink>}>
                            <Rows label={t('my_day_off_request')}>
                                <Row
                                    href="/dashboard/day-off-requests"
                                    title={dayOffWord(myLatestDayOffRequest.type)}
                                    detail={myLatestDayOffRequest.endDate && day(myLatestDayOffRequest.endDate) !== day(myLatestDayOffRequest.date)
                                        ? `${day(myLatestDayOffRequest.date)} – ${day(myLatestDayOffRequest.endDate)}`
                                        : day(myLatestDayOffRequest.date)}
                                    detailIcon={CalendarBlankIcon}
                                    end={<StatusBadge tone={dayOffTone(myLatestDayOffRequest.status)}>{statusWord(myLatestDayOffRequest.status)}</StatusBadge>}
                                />
                            </Rows>
                        </Section>
                    )}
                    <Section title={modules.label('obligations')} action={<SectionLink href="/dashboard/obligations">{t('view_all')}</SectionLink>}>
                        {myObligations.length === 0 ? (
                            <Panel><EmptyState icon={ClipboardTextIcon} title={t('no_obligations_assigned')} /></Panel>
                        ) : (
                            <Rows label={modules.label('obligations')}>
                                {myObligations.map(ob => (
                                    <Row
                                        key={ob.id}
                                        href={`/dashboard/obligations/${ob.id}`}
                                        title={ob.title}
                                        detail={`${t('due_by')} ${day(ob.deadline)}`}
                                        detailIcon={CalendarBlankIcon}
                                        end={<>
                                            <span className="ui-chip">{countOf(t, locale, ob.difficulty ?? 0, 'pts')}</span>
                                            {badge(ob.status)}
                                        </>}
                                    />
                                ))}
                            </Rows>
                        )}
                    </Section>
                </Columns>
            </Page>
        )
    }
}
