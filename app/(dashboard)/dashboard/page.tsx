import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { DonutChart, StatMetric } from "@/components/DashboardCharts"
import { cookies } from "next/headers"
import { Locale, translations } from "@/lib/translations"

export default async function DashboardPage({ searchParams }: { searchParams: { company?: string } }) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role
    const userId = (session?.user as any)?.id

    // Server-side localization
    const cookieStore = cookies()
    const locale = (cookieStore.get('NEXT_LOCALE')?.value || 'en') as Locale
    const t = (key: keyof typeof translations.en) => translations[locale][key] || translations.en[key]

    const formatDays = (days: number) => {
        if (locale === 'ar') {
            if (days === 1) return translations.ar.day_singular
            if (days === 2) return translations.ar.day_dual
            return `${days} ${translations.ar.days_label}`
        }
        return `${days} ${days === 1 ? translations.en.day_singular : translations.en.days_label}`
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
            const totalCompanies = await prisma.company.count()
            const totalUsers = await prisma.user.count()
            const totalTasks = await prisma.task.count()
            const totalClients = await prisma.businessClient.count()

            // Status distribution for Super Admin
            const taskStats = await prisma.task.groupBy({
                by: ['status'],
                _count: true
            })

            const chartData = [
                { label: t('status_completed'), value: taskStats.find(s => s.status === 'COMPLETED')?._count || 0, color: '#10b981' },
                { label: t('status_pending'), value: (taskStats.find(s => s.status === 'PENDING')?._count || 0) + (taskStats.find(s => s.status === 'IN_PROGRESS')?._count || 0), color: '#3b82f6' },
                { label: t('status_review'), value: taskStats.find(s => s.status === 'PENDING_CONFIRMATION')?._count || 0, color: '#f59e0b' },
                { label: t('status_others' as any), value: taskStats.filter((s: any) => !['COMPLETED', 'PENDING', 'IN_PROGRESS', 'PENDING_CONFIRMATION'].includes(s.status)).reduce((acc: any, s: any) => acc + s._count, 0), color: '#94a3b8' }
            ]

            return (
                <div className="animate-fade-in" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                    <header style={{ marginBottom: '2.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                        <h1 style={{ fontSize: '2rem', fontWeight: '800', color: '#1e293b' }}>
                            {t('system_overview')}
                        </h1>
                    </header>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', gridColumn: 'span 2' }}>
                            <StatMetric label={t('total_companies')} value={totalCompanies} icon="🏢" color="#6366f1" />
                            <StatMetric label={t('total_users')} value={totalUsers} icon="👥" color="#8b5cf6" />
                            <StatMetric label={t('total_tasks')} value={totalTasks} icon="✅" color="#10b981" />
                            <StatMetric label={t('business_clients')} value={totalClients} icon="🤝" color="#3b82f6" />
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
                            <Link href="/dashboard/all-users" className="btn" style={{ flex: 1, justifyContent: 'center', background: 'rgba(255,255,255,0.4)', color: '#334155', height: '3rem', border: '1px solid rgba(255,255,255,0.5)', minWidth: '200px' }}>
                                {t('view_all_users')}
                            </Link>
                        </div>
                    </div>
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
                    <h1 className="text-2xl font-bold text-slate-800">{t('unauthorized' as any)}</h1>
                    <p className="text-slate-500">{t('no_company_assigned' as any)}</p>
                </div>
            )
        }

        const baseWhere = finalCompanyId ? { assignee: { companyId: finalCompanyId } } : {}

        const totalTasks = await prisma.task.count({ where: baseWhere })
        const completedTasks = await prisma.task.count({ where: { ...baseWhere, status: 'COMPLETED' } })
        const pendingTasks = await prisma.task.count({ where: { ...baseWhere, status: 'PENDING' } })
        const reviewTasks = await prisma.task.count({ where: { ...baseWhere, status: 'PENDING_CONFIRMATION' } })
        const rejectedTasks = await prisma.task.count({ where: { ...baseWhere, status: 'REJECTED' } })

        const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

        // Fetch salary aggregates for the company
        const salaryStats = await prisma.salaryRecord.aggregate({
            where: {
                month: currentMonth,
                year: currentYear,
                user: finalCompanyId ? { companyId: finalCompanyId } : {}
            },
            _sum: {
                bonusDays: true,
                deductions: true
            }
        })

        const chartData = [
            { label: t('status_completed'), value: completedTasks, color: '#10b981' },
            { label: t('status_pending'), value: pendingTasks, color: '#3b82f6' },
            { label: t('status_review'), value: reviewTasks, color: '#f59e0b' },
            { label: t('status_rejected'), value: rejectedTasks, color: '#ef4444' }
        ]

        return (
            <div className="animate-fade-in" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                <header style={{ marginBottom: '2.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <h1 style={{ fontSize: '2rem', fontWeight: '800', color: '#1e293b' }}>
                        {userRole === 'TEAM_LEADER' ? t('team_performance') : t('admin_overview')}
                    </h1>
                </header>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
                    <div className="glass-card">
                        <DonutChart title={t('team_workload')} data={chartData} />
                    </div>
                    <div style={{ display: 'grid', gap: '1.5rem' }}>
                        <StatMetric label={t('task_completion')} value={`${completedTasks}/${totalTasks}`} icon="✅" color="#10b981" percentage={completionRate} subLabel={t('completion_rate')} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <StatMetric label={t('team_bonuses')} value={formatDays(salaryStats._sum.bonusDays || 0)} icon="⭐" color="#f59e0b" subLabel={t('total_this_month')} />
                            <StatMetric label={t('team_deductions')} value={formatDays(salaryStats._sum.deductions || 0)} icon="📉" color="#ef4444" subLabel={t('total_this_month')} />
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
                            <Link href="/dashboard/employees/new" className="btn" style={{ flex: 1, justifyContent: 'center', background: 'rgba(255,255,255,0.4)', color: '#334155', height: '3rem', border: '1px solid rgba(255,255,255,0.5)' }}>
                                + {t('add_employee')}
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        )
    } else {
        // Employee View
        const myTasks = await (prisma.task as any).findMany({
            where: {
                OR: [
                    { assigneeId: userId },
                    { assignees: { some: { id: userId } } }
                ]
            },
            include: {
                assignee: { select: { firstName: true, lastName: true } },
                assignees: { select: { id: true, firstName: true, lastName: true } },
                creator: { select: { firstName: true, lastName: true } }
            },
            orderBy: { deadline: 'asc' }
        })

        const totalTasks = myTasks.length
        const completedTasks = myTasks.filter((t: any) => t.status === 'COMPLETED').length
        const pendingTasks = myTasks.filter((t: any) => t.status === 'PENDING' || t.status === 'IN_PROGRESS').length
        const reviewTasks = myTasks.filter((t: any) => t.status === 'PENDING_CONFIRMATION').length
        const rejectedTasks = myTasks.filter((t: any) => t.status === 'REJECTED').length

        const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

        // Fetch current user details for dayOffCredit
        const currentUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { dayOffCredit: true }
        })

        // Fetch approved day off requests for "used" credit
        const approvedRequests = await prisma.dayOffRequest.findMany({
            where: {
                userId: userId,
                status: 'APPROVED'
            },
            select: { daysDeducted: true }
        })
        const usedCredits = approvedRequests.reduce((acc, req) => acc + (req.daysDeducted || 0), 0)

        // Fetch salary record for current month
        const salaryRecord = await prisma.salaryRecord.findUnique({
            where: {
                userId_month_year: {
                    userId: userId,
                    month: currentMonth,
                    year: currentYear
                }
            }
        })

        const myObligations = await prisma.obligation.findMany({
            where: { assigneeId: userId },
            orderBy: { deadline: 'asc' },
            include: { assignee: true }
        })

        const today = new Date()
        today.setHours(0, 0, 0, 0)

        const todayTasks = myTasks.filter((task: any) => {
            const deadline = new Date(task.deadline)
            deadline.setHours(0, 0, 0, 0)
            return deadline.getTime() === today.getTime() && task.status !== 'APPROVED' && task.status !== 'COMPLETED'
        })

        const chartData = [
            { label: t('status_completed'), value: completedTasks, color: '#10b981' },
            { label: t('status_pending'), value: pendingTasks, color: '#3b82f6' },
            { label: t('status_review'), value: reviewTasks, color: '#f59e0b' },
            { label: t('status_rejected'), value: rejectedTasks, color: '#ef4444' }
        ]

        const dateString = new Date().toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })

        return (
            <div className="animate-fade-in">
                <header style={{ marginBottom: '3rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
                        <div>
                            <h1 style={{ fontSize: '2.25rem', fontWeight: '800', color: '#1e293b', marginBottom: '0.5rem' }}>
                                {t('hello')}, {(session?.user as any)?.firstName}! 👋
                            </h1>
                        </div>
                        <div style={{ textAlign: locale === 'ar' ? 'left' : 'right' }}>
                            <div style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: '500' }}>{dateString}</div>
                        </div>
                    </div>
                </header>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
                    <div className="glass-card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                        <DonutChart title={t('task_distribution')} data={chartData} />
                        <DonutChart
                            title={t('credit_overview' as any)}
                            data={[
                                { label: t('remaining_credit' as any), value: currentUser?.dayOffCredit || 0, color: '#10b981' },
                                { label: t('used_credit' as any), value: usedCredits, color: '#ef4444' }
                            ]}
                        />
                    </div>
                    <div style={{ display: 'grid', gap: '1.5rem' }}>
                        <StatMetric label={t('overall_progress')} value={`${completedTasks}/${totalTasks}`} icon="🎯" color="#6366f1" percentage={completionRate} subLabel={t('completion_rate')} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <StatMetric label={t('bonus')} value={formatDays(salaryRecord?.bonusDays || 0)} icon="🎁" color="#f59e0b" subLabel={t('extra_earnings')} />
                            <StatMetric label={t('team_deductions')} value={formatDays(salaryRecord?.deductions || 0)} icon="📉" color="#ef4444" subLabel={t('total_lost_days')} />
                        </div>
                    </div>
                </div>

                {/* Today's Focus */}
                <section style={{ marginBottom: '3rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: '700', margin: 0 }}>🔥 {t('due_today')}</h2>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
                        {todayTasks.length === 0 ? (
                            <div className="glass-card glass-success animate-delay-100" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '2rem' }}>
                                <div style={{ fontSize: '3rem', background: 'rgba(255,255,255,0.8)', borderRadius: '50%', width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>🎉</div>
                                <div>
                                    <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', fontWeight: '700', color: '#166534' }}>{t('all_caught_up')}</h3>
                                    <p style={{ margin: 0, color: '#15803d' }}>{t('no_pending_tasks_today')}</p>
                                </div>
                            </div>
                        ) : (
                            todayTasks.map((task: any, idx: number) => (
                                <Link key={task.id} href={`/dashboard/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                                    <div className="glass-card" style={{ height: '100%', boxSizing: 'border-box', [locale === 'ar' ? 'borderRight' : 'borderLeft']: '6px solid #ef4444', padding: '1.75rem' }}>
                                        <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                <h3 style={{ fontSize: '1.25rem', fontWeight: '700', lineHeight: '1.3', color: '#1e293b' }}>{task.title}</h3>
                                                <span style={{
                                                    padding: '0.15rem 0.5rem',
                                                    borderRadius: '0.5rem',
                                                    background: '#3b82f6',
                                                    color: 'white',
                                                    fontWeight: 'bold',
                                                    fontSize: '0.7rem'
                                                }}>
                                                    {task.difficulty} {t('pts')}
                                                </span>
                                            </div>
                                            <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>{t('today')}</span>
                                        </div>
                                        <p style={{ color: '#64748b', fontSize: '0.95rem', lineHeight: '1.6', marginBottom: '1.5rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                            {task.description}
                                        </p>
                                        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '1rem' }}>
                                            <span className="badge" style={{ background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0' }}>{t(`status_${task.status.toLowerCase()}` as any)}</span>
                                            <span style={{ fontSize: '0.9rem', fontWeight: '600', color: '#4f46e5' }}>{t('view_all')} →</span>
                                        </div>
                                    </div>
                                </Link>
                            ))
                        )}
                    </div>
                </section>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2.5rem', alignItems: 'start' }}>
                    {/* Obligations */}
                    <section>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: '#334155' }}>📌 {t('obligations')}</h2>
                            <Link href="/dashboard/obligations" style={{ fontSize: '0.9rem', fontWeight: '500' }}>{t('view_all')}</Link>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {myObligations.length === 0 ? (
                                <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
                                    <p style={{ margin: 0, color: '#94a3b8' }}>{t('no_obligations_assigned')}</p>
                                </div>
                            ) : (
                                myObligations.slice(0, 5).map(ob => (
                                    <Link key={ob.id} href={`/dashboard/obligations/${ob.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                                        <div className="glass-card" style={{ padding: '1.25rem', [locale === 'ar' ? 'borderRight' : 'borderLeft']: '4px solid #0ea5e9' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <h3 style={{ fontSize: '1rem', fontWeight: '600', margin: 0 }}>{ob.title}</h3>
                                                    <span style={{
                                                        padding: '0.1rem 0.4rem',
                                                        borderRadius: '0.4rem',
                                                        background: '#3b82f6',
                                                        color: 'white',
                                                        fontWeight: 'bold',
                                                        fontSize: '0.65rem'
                                                    }}>
                                                        {ob.difficulty} {t('pts')}
                                                    </span>
                                                </div>
                                                <span className="badge" style={{
                                                    background: ob.status === 'COMPLETED' ? '#dcfce7' : '#f0f9ff',
                                                    color: ob.status === 'COMPLETED' ? '#166534' : '#0369a1',
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
                                            <div style={{ fontSize: '0.85rem', color: '#64748b' }}>{t('due_by')} {new Date(ob.deadline).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}</div>
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
