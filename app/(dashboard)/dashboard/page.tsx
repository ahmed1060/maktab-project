import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { DonutChart, StatMetric } from "@/components/DashboardCharts"
import HeaderSetter from "@/components/HeaderSetter"
import { cookies } from "next/headers"
import type { Locale, TranslationKey } from "@/lib/translations"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"
import { getSuperAdminOverviewStats } from "@/lib/services/dashboard-stats.service"
import { modulesFrom } from "@/lib/modules"
import { SCOPED_COMPANY_COOKIE, scopedCompanyId } from "@/lib/company-scope"
import { CompanyService } from "@/lib/services/company.service"

export const dynamic = 'force-dynamic'

export default async function DashboardPage(props: { searchParams: Promise<{ company?: string }> }) {
    // Next 15 hands a page its dynamic segments and query string as
    // promises rather than plain objects, so they are awaited here and
    // the rest of the function reads them exactly as it did before.
    const searchParams = await props.searchParams

    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role
    const userId = (session?.user as any)?.id

    // Server-side localization
    // Awaited since Next 15: cookies(), headers() and draftMode() are async,
    // because a request's store is now resolved when it is asked for rather
    // than assumed to be already there.
    const cookieStore = await cookies()
    const locale = (cookieStore.get('NEXT_LOCALE')?.value || 'en') as Locale
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

    const formatDays = (days: number) => {
        if (locale === 'ar') {
            if (days === 1) return ar.day_singular
            if (days === 2) return ar.day_dual
            return `${days} ${ar.days_label}`
        }
        return `${days} ${days === 1 ? en.day_singular : en.days_label}`
    }

    let companyId: string | undefined = undefined
    if (searchParams.company) {
        const comp = await prisma.company.findUnique({ where: { name: searchParams.company } })
        if (comp) companyId = comp.id
    }

    const currentMonth = new Date().getMonth() + 1
    const currentYear = new Date().getFullYear()

    if (['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        // Super Admin System Overview (when no specific company is selected)
        if (userRole === 'SUPER_ADMIN' && !companyId) {
            // "Needs Attention" — the things a super admin would otherwise
            // only find by opening each page individually. Recomputed here
            // (not read from the cached stats below) only for the audit-log
            // link's date boundary — a few seconds' difference from the
            // cached query's own internal snapshot doesn't matter for that.
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

            // Cached 30s — this is the same read for every super admin
            // regardless of who's looking, unlike the company/employee views
            // below which stay uncached since people expect those to reflect
            // their own just-taken action immediately. See
            // lib/services/dashboard-stats.service.ts for why.
            const { totalCompanies, totalUsers, totalTasks, totalClients, taskStats, systemErrors24h, expiringSubscriptions, bannedCompanies } = await getSuperAdminOverviewStats()

            const chartData = [
                { label: t('status_completed'), value: taskStats.find(s => s.status === 'COMPLETED')?._count || 0, color: 'var(--ok-solid)' },
                { label: t('status_pending'), value: (taskStats.find(s => s.status === 'PENDING')?._count || 0) + (taskStats.find(s => s.status === 'IN_PROGRESS')?._count || 0), color: 'var(--info-solid)' },
                { label: t('status_review'), value: taskStats.find(s => s.status === 'PENDING_CONFIRMATION')?._count || 0, color: 'var(--warn-solid)' },
                { label: t('status_others' as any), value: taskStats.filter((s: any) => !['COMPLETED', 'PENDING', 'IN_PROGRESS', 'PENDING_CONFIRMATION'].includes(s.status)).reduce((acc: any, s: any) => acc + s._count, 0), color: 'var(--text-faint)' }
            ]

            return (
                <div className="animate-fade-in" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                    <HeaderSetter title={t('system_overview')} subtitle={t('dashboard_subtitle' as any)} />

                    <div className="dashboard-stats-grid">
                        <div className="dashboard-stats-block">
                            <StatMetric label={t('total_companies')} value={totalCompanies} icon="🏢" color="var(--brand-primary)" />
                            <StatMetric label={t('total_users')} value={totalUsers} icon="👥" color="var(--brand-accent)" />
                            <StatMetric label={t('total_tasks')} value={totalTasks} icon="✅" color="var(--ok-solid)" />
                            <StatMetric label={t('business_clients')} value={totalClients} icon="🤝" color="var(--info-solid)" />
                        </div>
                        <div className="glass-card">
                            <DonutChart title={t('global_task_status')} data={chartData} />
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="glass-card animate-delay-300">
                        <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem', fontWeight: '700' }}>{t('quick_actions')}</h3>
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            <Link href="/dashboard/companies" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', height: '3rem', minWidth: '200px' }}>
                                {t('manage_companies')}
                            </Link>
                            <Link href="/dashboard/all-users" className="btn" style={{ flex: 1, justifyContent: 'center', background: 'var(--veil-40)', color: 'var(--text-body)', height: '3rem', border: '1px solid var(--veil-50)', minWidth: '200px' }}>
                                {t('view_all_users')}
                            </Link>
                        </div>
                    </div>

                    {/* Needs Attention */}
                    <section>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-body)', marginBottom: '1.25rem' }}>⚠️ {t('needs_attention')}</h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
                            <Link href={`/dashboard/audit-logs?action=SYSTEM_API_ERROR&startDate=${encodeURIComponent(oneDayAgo.toISOString())}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                                <StatMetric label={t('system_errors_24h')} value={systemErrors24h} icon="🚨" color="var(--danger-solid)" />
                            </Link>
                            <Link href="/dashboard/companies" style={{ textDecoration: 'none', color: 'inherit' }}>
                                <StatMetric label={t('expiring_subscriptions')} value={expiringSubscriptions} icon="⏳" color="var(--warn-solid)" />
                            </Link>
                            <Link href="/dashboard/companies" style={{ textDecoration: 'none', color: 'inherit' }}>
                                <StatMetric label={t('banned_companies')} value={bannedCompanies} icon="🚫" color="var(--text-faint)" />
                            </Link>
                        </div>
                    </section>

                </div>
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
                <div className="flex flex-col items-center justify-center py-20">
                    <h1 className="text-2xl font-bold text-slate-800">{t('unauthorized')}</h1>
                    <p className="text-slate-500">{t('no_company_assigned')}</p>
                </div>
            )
        }

        const baseWhere = finalCompanyId ? { companyId: finalCompanyId } : {}

        // "Needs Your Review" — approval queues this role can act on.
        // Day-off/profile approval is ADMIN-only (see app/api/admin/day-off-requests
        // and app/api/profile-requests), so a TEAM_LEADER only sees task reviews.
        // Below runs everything together instead of as 4-5 sequential
        // round trips: taskStats/salaryStats/overdueTasks never depended on
        // each other, and the two ADMIN-only counts just resolve to 0
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
                    user: finalCompanyId ? { companyId: finalCompanyId } : {}
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
            userRole === 'ADMIN'
                ? prisma.dayOffRequest.count({ where: { status: 'PENDING', user: { companyId: finalCompanyId } } })
                : Promise.resolve(0),
            userRole === 'ADMIN'
                ? prisma.profileUpdateRequest.count({ where: { status: 'PENDING', user: { companyId: finalCompanyId } } })
                : Promise.resolve(0)
        ])

        const totalTasks = taskStats.reduce((acc, s) => acc + s._count, 0)
        const completedTasks = taskStats.find(s => s.status === 'COMPLETED')?._count || 0
        const pendingTasks = taskStats.find(s => s.status === 'PENDING')?._count || 0
        const reviewTasks = taskStats.find(s => s.status === 'PENDING_CONFIRMATION')?._count || 0
        const rejectedTasks = taskStats.find(s => s.status === 'REJECTED')?._count || 0

        const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

        const chartData = [
            { label: t('status_completed'), value: completedTasks, color: 'var(--ok-solid)' },
            { label: t('status_pending'), value: pendingTasks, color: 'var(--info-solid)' },
            { label: t('status_review'), value: reviewTasks, color: 'var(--warn-solid)' },
            { label: t('status_rejected'), value: rejectedTasks, color: 'var(--danger-solid)' }
        ]

        return (
            <div className="animate-fade-in" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                <HeaderSetter
                    title={userRole === 'TEAM_LEADER' ? t('team_performance') : t('admin_overview')}
                    subtitle={t('dashboard_subtitle' as any)}
                />

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
                    <div className="glass-card">
                        <DonutChart title={t('team_workload')} data={chartData} />
                    </div>
                    <div style={{ display: 'grid', gap: '1.5rem' }}>
                        <StatMetric label={t('task_completion')} value={`${completedTasks}/${totalTasks}`} icon={modules.icon('tasks')} color="var(--ok-solid)" percentage={completionRate} subLabel={t('completion_rate')} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <StatMetric label={t('team_bonuses')} value={formatDays(Number(salaryStats._sum.bonusDays || 0))} icon="⭐" color="var(--warn-solid)" subLabel={t('total_this_month')} />
                            <StatMetric label={t('team_deductions')} value={formatDays(Number(salaryStats._sum.deductions || 0))} icon="📉" color="var(--danger-solid)" subLabel={t('total_this_month')} />
                        </div>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
                    <div className="glass-card" style={{ height: 'fit-content' }}>
                        <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem', fontWeight: '700' }}>{t('quick_actions')}</h3>
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            <Link href="/dashboard/tasks/new" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', height: '3rem' }}>
                                + {t('create_new_task')}
                            </Link>
                            {userRole !== 'TEAM_LEADER' && (
                                <Link href="/dashboard/employees/new" className="btn" style={{ flex: 1, justifyContent: 'center', background: 'var(--veil-40)', color: 'var(--text-body)', height: '3rem', border: '1px solid var(--veil-50)' }}>
                                    + {t('add_employee')}
                                </Link>
                            )}
                        </div>
                    </div>
                </div>

                {/* Needs Your Review */}
                <section style={{ marginTop: '2.5rem' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-body)', marginBottom: '1.25rem' }}>📋 {t('needs_your_review')}</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
                        <Link href="/dashboard/tasks" style={{ textDecoration: 'none', color: 'inherit' }}>
                            <StatMetric label={t('pending_task_reviews')} value={reviewTasks} icon="🔎" color="var(--warn-solid)" />
                        </Link>
                        {userRole === 'ADMIN' && (
                            <>
                                <Link href="/dashboard/day-off-requests" style={{ textDecoration: 'none', color: 'inherit' }}>
                                    <StatMetric label={t('pending_day_off_requests')} value={pendingDayOffRequests} icon={modules.icon('dayOff')} color="var(--info-solid-sky)" />
                                </Link>
                                <Link href="/dashboard/profile-requests" style={{ textDecoration: 'none', color: 'inherit' }}>
                                    <StatMetric label={t('pending_profile_requests')} value={pendingProfileRequests} icon="🪪" color="var(--brand-accent)" />
                                </Link>
                            </>
                        )}
                    </div>
                </section>

                {/* Overdue Tasks */}
                <section style={{ marginTop: '2.5rem' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-body)', marginBottom: '1.25rem' }}>⏰ {t('overdue_tasks')}</h2>
                    {overdueTasks.length === 0 ? (
                        <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
                            <p style={{ margin: 0, color: 'var(--text-faint)' }}>{t('no_overdue_tasks')}</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {overdueTasks.map(task => (
                                <Link key={task.id} href={`/dashboard/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                                    <div className="glass-card" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', [locale === 'ar' ? 'borderRight' : 'borderLeft']: '4px solid var(--danger-solid)' }}>
                                        <span style={{ fontWeight: '600' }}>{task.title}</span>
                                        <span style={{ fontSize: '0.85rem', color: 'var(--danger-solid)' }}>{new Date(task.deadline).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}</span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        )
    } else {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const tomorrow = new Date(today)
        tomorrow.setDate(tomorrow.getDate() + 1)
        const weekFromNow = new Date(today)
        weekFromNow.setDate(weekFromNow.getDate() + 7)

        // Optimized Employee View: Use groupBy for stats and targeted fetch
        // for today's focus. All 7 of these are independent of each other —
        // previously fired as 7 sequential awaits, so this page paid for 7
        // separate round trips to Postgres before it could render anything.
        // Running them together costs one round trip's worth of latency.
        const [taskStats, currentUser, approvedRequests, salaryRecord, myObligations, myLatestDayOffRequest, upcomingTasks] = await Promise.all([
            prisma.task.groupBy({
                where: {
                    assignees: { some: { id: userId } }
                },
                by: ['status'],
                _count: true
            }),
            // Current user details for dayOffCredit
            prisma.user.findUnique({
                where: { id: userId },
                select: { dayOffCredit: true }
            }),
            // Approved day off requests for "used" credit
            prisma.dayOffRequest.findMany({
                where: {
                    userId: userId,
                    status: 'APPROVED'
                },
                select: { daysDeducted: true }
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
        const pendingTasks = (taskStats.find(s => s.status === 'PENDING')?._count || 0) + (taskStats.find(s => s.status === 'IN_PROGRESS')?._count || 0)
        const reviewTasks = taskStats.find(s => s.status === 'PENDING_CONFIRMATION')?._count || 0
        const rejectedTasks = taskStats.find(s => s.status === 'REJECTED')?._count || 0

        const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
        const usedCredits = approvedRequests.reduce((acc, req) => acc + (req.daysDeducted || 0), 0)

        const chartData = [
            { label: t('status_completed'), value: completedTasks, color: 'var(--ok-solid)' },
            { label: t('status_pending'), value: pendingTasks, color: 'var(--info-solid)' },
            { label: t('status_review'), value: reviewTasks, color: 'var(--warn-solid)' },
            { label: t('status_rejected'), value: rejectedTasks, color: 'var(--danger-solid)' }
        ]


        return (
            <div className="animate-fade-in">
                <HeaderSetter
                    title={`${t('hello')}, ${(session?.user as any)?.firstName}! 👋`}
                    subtitle={t('dashboard_subtitle' as any)}
                />

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
                    <div className="glass-card dashboard-chart-grid" style={{ display: 'grid', gap: '1.5rem' }}>
                        <DonutChart title={t('task_distribution')} data={chartData} />
                        <DonutChart
                            title={t('credit_overview' as any)}
                            data={[
                                { label: t('remaining_credit' as any), value: currentUser?.dayOffCredit || 0, color: 'var(--ok-solid)' },
                                { label: t('used_credit' as any), value: usedCredits, color: 'var(--danger-solid)' }
                            ]}
                        />
                    </div>
                    <div style={{ display: 'grid', gap: '1.5rem' }}>
                        <StatMetric label={t('overall_progress')} value={`${completedTasks}/${totalTasks}`} icon="🎯" color="var(--brand-primary)" percentage={completionRate} subLabel={t('completion_rate')} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <StatMetric label={t('bonus')} value={formatDays(Number(salaryRecord?.bonusDays || 0))} icon="🎁" color="var(--warn-solid)" subLabel={t('extra_earnings')} />
                            <StatMetric label={t('team_deductions')} value={formatDays(Number(salaryRecord?.deductions || 0))} icon="📉" color="var(--danger-solid)" subLabel={t('total_lost_days')} />
                        </div>
                    </div>
                </div>

                {/* This Week's Focus */}
                <section style={{ marginBottom: '3rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: '700', margin: 0 }}>🔥 {t('due_this_week')}</h2>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
                        {upcomingTasks.length === 0 ? (
                            <div className="glass-card glass-success animate-delay-100" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '2rem' }}>
                                <div style={{ fontSize: '3rem', background: 'var(--panel-80)', borderRadius: '50%', width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 6px -1px var(--shadow-faint)' }}>🎉</div>
                                <div>
                                    <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', fontWeight: '700', color: 'var(--ok-fg)' }}>{t('all_caught_up')}</h3>
                                    <p style={{ margin: 0, color: 'var(--ok-fg-strong)' }}>{t('no_pending_tasks_week')}</p>
                                </div>
                            </div>
                        ) : (
                            upcomingTasks.map((task: any) => {
                                const isDueToday = new Date(task.deadline) < tomorrow
                                return (
                                    <Link key={task.id} href={`/dashboard/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                                        <div className="glass-card" style={{ height: '100%', boxSizing: 'border-box', [locale === 'ar' ? 'borderRight' : 'borderLeft']: `6px solid ${isDueToday ? 'var(--danger-solid)' : 'var(--warn-solid)'}`, padding: '1.75rem' }}>
                                            <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                    <h3 style={{ fontSize: '1.25rem', fontWeight: '700', lineHeight: '1.3', color: 'var(--text-main)' }}>{task.title}</h3>
                                                    <span style={{
                                                        padding: '0.15rem 0.5rem',
                                                        borderRadius: '0.5rem',
                                                        background: 'var(--info-solid)',
                                                        color: 'var(--text-on-accent)',
                                                        fontWeight: 'bold',
                                                        fontSize: '0.7rem'
                                                    }}>
                                                        {task.difficulty} {t('pts')}
                                                    </span>
                                                </div>
                                                <span className="badge" style={{ background: isDueToday ? 'var(--danger-bg)' : 'var(--warn-bg-warm)', color: isDueToday ? 'var(--danger-fg-strong)' : 'var(--warn-fg-warm-strong)' }}>
                                                    {isDueToday ? t('today') : new Date(task.deadline).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' })}
                                                </span>
                                            </div>
                                            <p style={{ color: 'var(--text-soft)', fontSize: '0.95rem', lineHeight: '1.6', marginBottom: '1.5rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                                {task.description}
                                            </p>
                                            <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--veil-20)', paddingTop: '1rem' }}>
                                                <span className="badge" style={{ background: 'var(--surface-subtle)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{t(`status_${task.status.toLowerCase()}` as any)}</span>
                                                <span style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--brand-primary-hover)' }}>{t('view_all')} →</span>
                                            </div>
                                        </div>
                                    </Link>
                                )
                            })
                        )}
                    </div>
                </section>

                {/* My Latest Day-Off Request */}
                {myLatestDayOffRequest && (
                    <section style={{ marginBottom: '3rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-body)' }}>{modules.icon('dayOff')} {t('my_day_off_request')}</h2>
                            <Link href="/dashboard/day-off-requests" style={{ fontSize: '0.9rem', fontWeight: '500' }}>{t('view_all')}</Link>
                        </div>
                        <Link href="/dashboard/day-off-requests" style={{ textDecoration: 'none', color: 'inherit' }}>
                            <div className="glass-card" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', [locale === 'ar' ? 'borderRight' : 'borderLeft']: `4px solid ${myLatestDayOffRequest.status === 'APPROVED' ? 'var(--ok-solid)' : myLatestDayOffRequest.status === 'REJECTED' ? 'var(--danger-solid)' : 'var(--info-solid-sky)'}` }}>
                                <div>
                                    <div style={{ fontWeight: '600' }}>{t(`${myLatestDayOffRequest.type.toLowerCase()}_day_off` as any)}</div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-soft)', marginTop: '0.25rem' }}>
                                        {new Date(myLatestDayOffRequest.date).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}
                                        {myLatestDayOffRequest.endDate ? ` – ${new Date(myLatestDayOffRequest.endDate).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}` : ''}
                                    </div>
                                </div>
                                <span className="badge" style={{
                                    background: myLatestDayOffRequest.status === 'APPROVED' ? 'var(--ok-bg)' : myLatestDayOffRequest.status === 'REJECTED' ? 'var(--danger-bg)' : 'var(--info-bg-sky)',
                                    color: myLatestDayOffRequest.status === 'APPROVED' ? 'var(--ok-fg)' : myLatestDayOffRequest.status === 'REJECTED' ? 'var(--danger-fg-strong)' : 'var(--info-fg)'
                                }}>
                                    {t(`status_${myLatestDayOffRequest.status.toLowerCase()}` as any)}
                                </span>
                            </div>
                        </Link>
                    </section>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2.5rem', alignItems: 'start' }}>
                    {/* Obligations */}
                    <section>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-body)' }}>{modules.icon('obligations')} {modules.label('obligations')}</h2>
                            <Link href="/dashboard/obligations" style={{ fontSize: '0.9rem', fontWeight: '500' }}>{t('view_all')}</Link>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {myObligations.length === 0 ? (
                                <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
                                    <p style={{ margin: 0, color: 'var(--text-faint)' }}>{t('no_obligations_assigned')}</p>
                                </div>
                            ) : (
                                myObligations.slice(0, 5).map(ob => (
                                    <Link key={ob.id} href={`/dashboard/obligations/${ob.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                                        <div className="glass-card" style={{ padding: '1.25rem', [locale === 'ar' ? 'borderRight' : 'borderLeft']: '4px solid var(--info-solid-sky)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <h3 style={{ fontSize: '1rem', fontWeight: '600', margin: 0 }}>{ob.title}</h3>
                                                    <span style={{
                                                        padding: '0.1rem 0.4rem',
                                                        borderRadius: '0.4rem',
                                                        background: 'var(--info-solid)',
                                                        color: 'var(--text-on-accent)',
                                                        fontWeight: 'bold',
                                                        fontSize: '0.65rem'
                                                    }}>
                                                        {ob.difficulty} {t('pts')}
                                                    </span>
                                                </div>
                                                <span className="badge" style={{
                                                    background: ob.status === 'COMPLETED' ? 'var(--ok-bg)' : 'var(--info-bg-sky)',
                                                    color: ob.status === 'COMPLETED' ? 'var(--ok-fg)' : 'var(--info-fg)',
                                                    fontSize: '0.7rem'
                                                }}>
                                                    {t(`status_${ob.status.toLowerCase()}` as any)}
                                                    {(ob as any).lastStatusUpdateBy && (['COMPLETED', 'APPROVED', 'REJECTED'].includes(ob.status)) && (
                                                        <span style={{ fontSize: '0.65rem', opacity: 0.8, fontWeight: 'normal' }}>
                                                            • {(ob as any).lastStatusUpdateBy}
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-soft)' }}>{t('due_by')} {new Date(ob.deadline).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}</div>
                                        </div>
                                    </Link>
                                ))
                            )}
                        </div>
                    </section>
                </div>
            </div>
        )
    }
}
