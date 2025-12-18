import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { DonutChart, StatMetric } from "@/components/DashboardCharts"

export default async function DashboardPage({ searchParams }: { searchParams: { company?: string } }) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role
    const userId = (session?.user as any)?.id

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
                { label: 'Completed', value: taskStats.find(s => s.status === 'COMPLETED')?._count || 0, color: '#10b981' },
                { label: 'Pending', value: (taskStats.find(s => s.status === 'PENDING')?._count || 0) + (taskStats.find(s => s.status === 'IN_PROGRESS')?._count || 0), color: '#3b82f6' },
                { label: 'Review', value: taskStats.find(s => s.status === 'PENDING_CONFIRMATION')?._count || 0, color: '#f59e0b' },
                { label: 'Others', value: taskStats.filter(s => !['COMPLETED', 'PENDING', 'IN_PROGRESS', 'PENDING_CONFIRMATION'].includes(s.status)).reduce((acc, s) => acc + s._count, 0), color: '#94a3b8' }
            ]

            return (
                <div className="animate-fade-in">
                    <header style={{ marginBottom: '2.5rem' }}>
                        <h1 style={{ fontSize: '2rem', fontWeight: '800', color: '#1e293b' }}>
                            System Overview
                        </h1>
                    </header>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', gridColumn: 'span 2' }}>
                            <StatMetric label="Total Companies" value={totalCompanies} icon="🏢" color="#6366f1" />
                            <StatMetric label="Total Users" value={totalUsers} icon="👥" color="#8b5cf6" />
                            <StatMetric label="Total Tasks" value={totalTasks} icon="✅" color="#10b981" />
                            <StatMetric label="Business Clients" value={totalClients} icon="🤝" color="#3b82f6" />
                        </div>
                        <div className="glass-card">
                            <DonutChart title="Global Task Status" data={chartData} />
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="glass-card animate-delay-300">
                        <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem', fontWeight: '700' }}>Quick Actions</h3>
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            <Link href="/dashboard/companies" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', height: '3rem', minWidth: '200px' }}>
                                Manage Companies
                            </Link>
                            <Link href="/dashboard/all-users" className="btn" style={{ flex: 1, justifyContent: 'center', background: 'rgba(255,255,255,0.4)', color: '#334155', height: '3rem', border: '1px solid rgba(255,255,255,0.5)', minWidth: '200px' }}>
                                View All Users
                            </Link>
                        </div>
                    </div>
                </div>
            )
        }

        // Regular Admin/Team Leader view
        const baseWhere = companyId ? { assignee: { companyId } } : (userRole === 'TEAM_LEADER' ? { assignee: { companyId: (session?.user as any).companyId } } : {})

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
                user: companyId ? { companyId } : (userRole === 'TEAM_LEADER' ? { companyId: (session?.user as any).companyId } : {})
            },
            _sum: {
                bonusDays: true,
                deductions: true
            }
        })

        const chartData = [
            { label: 'Completed', value: completedTasks, color: '#10b981' },
            { label: 'Pending', value: pendingTasks, color: '#3b82f6' },
            { label: 'Review', value: reviewTasks, color: '#f59e0b' },
            { label: 'Rejected', value: rejectedTasks, color: '#ef4444' }
        ]

        return (
            <div className="animate-fade-in">
                <header style={{ marginBottom: '2.5rem' }}>
                    <h1 style={{ fontSize: '2rem', fontWeight: '800', color: '#1e293b' }}>
                        {userRole === 'TEAM_LEADER' ? 'Team Performance' : 'Admin Overview'}
                    </h1>
                </header>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
                    <div className="glass-card">
                        <DonutChart title="Team Workload" data={chartData} />
                    </div>
                    <div style={{ display: 'grid', gap: '1.5rem' }}>
                        <StatMetric label="Task Completion" value={`${completedTasks}/${totalTasks}`} icon="✅" color="#10b981" percentage={completionRate} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <StatMetric label="Team Bonuses" value={`${salaryStats._sum.bonusDays || 0}d`} icon="⭐" color="#f59e0b" subLabel="Total this month" />
                            <StatMetric label="Team Deductions" value={`${salaryStats._sum.deductions || 0}d`} icon="📉" color="#ef4444" subLabel="Total this month" />
                        </div>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
                    <div className="glass-card" style={{ height: 'fit-content' }}>
                        <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem', fontWeight: '700' }}>Quick Actions</h3>
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            <Link href="/dashboard/tasks/new" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', height: '3rem' }}>
                                + Create New Task
                            </Link>
                            <Link href="/dashboard/employees/new" className="btn" style={{ flex: 1, justifyContent: 'center', background: 'rgba(255,255,255,0.4)', color: '#334155', height: '3rem', border: '1px solid rgba(255,255,255,0.5)' }}>
                                + Add Employee
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        )
    } else {
        // Employee View
        const myTasks = await prisma.task.findMany({
            where: { assigneeId: userId },
            orderBy: { deadline: 'asc' }
        })

        const totalTasks = myTasks.length
        const completedTasks = myTasks.filter(t => t.status === 'COMPLETED').length
        const pendingTasks = myTasks.filter(t => t.status === 'PENDING' || t.status === 'IN_PROGRESS').length
        const reviewTasks = myTasks.filter(t => t.status === 'PENDING_CONFIRMATION').length
        const rejectedTasks = myTasks.filter(t => t.status === 'REJECTED').length

        const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

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

        const todayTasks = myTasks.filter(task => {
            const deadline = new Date(task.deadline)
            deadline.setHours(0, 0, 0, 0)
            return deadline.getTime() === today.getTime() && task.status !== 'APPROVED' && task.status !== 'COMPLETED'
        })

        const chartData = [
            { label: 'Completed', value: completedTasks, color: '#10b981' },
            { label: 'Pending', value: pendingTasks, color: '#3b82f6' },
            { label: 'Review', value: reviewTasks, color: '#f59e0b' },
            { label: 'Rejected', value: rejectedTasks, color: '#ef4444' }
        ]

        return (
            <div className="animate-fade-in">
                <header style={{ marginBottom: '3rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
                        <div>
                            <h1 style={{ fontSize: '2.25rem', fontWeight: '800', color: '#1e293b', marginBottom: '0.5rem' }}>
                                Hello, {(session?.user as any)?.firstName}! 👋
                            </h1>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: '500' }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
                        </div>
                    </div>
                </header>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
                    <div className="glass-card">
                        <DonutChart title="Task Distribution" data={chartData} />
                    </div>
                    <div style={{ display: 'grid', gap: '1.5rem' }}>
                        <StatMetric label="Overall Progress" value={`${completedTasks}/${totalTasks}`} icon="🎯" color="#6366f1" percentage={completionRate} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <StatMetric label="Bonus" value={`${salaryRecord?.bonusDays || 0}d`} icon="🎁" color="#f59e0b" subLabel="Extra earnings" />
                            <StatMetric label="Deductions" value={`${salaryRecord?.deductions || 0}d`} icon="📉" color="#ef4444" subLabel="Total lost days" />
                        </div>
                    </div>
                </div>

                {/* Today's Focus */}
                <section style={{ marginBottom: '3rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: '700', margin: 0 }}>🔥 Due Today</h2>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
                        {todayTasks.length === 0 ? (
                            <div className="glass-card glass-success animate-delay-100" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '2rem' }}>
                                <div style={{ fontSize: '3rem', background: 'rgba(255,255,255,0.8)', borderRadius: '50%', width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>🎉</div>
                                <div>
                                    <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', fontWeight: '700', color: '#166534' }}>All Caught Up!</h3>
                                    <p style={{ margin: 0, color: '#15803d' }}>You have no pending tasks due today.</p>
                                </div>
                            </div>
                        ) : (
                            todayTasks.map((task, idx) => (
                                <Link key={task.id} href={`/dashboard/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                                    <div className="glass-card" style={{ height: '100%', boxSizing: 'border-box', borderLeft: '6px solid #ef4444', padding: '1.75rem' }}>
                                        <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                            <h3 style={{ fontSize: '1.25rem', fontWeight: '700', lineHeight: '1.3', color: '#1e293b' }}>{task.title}</h3>
                                            <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>Today</span>
                                        </div>
                                        <p style={{ color: '#64748b', fontSize: '0.95rem', lineHeight: '1.6', marginBottom: '1.5rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                            {task.description}
                                        </p>
                                        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '1rem' }}>
                                            <span className="badge" style={{ background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0' }}>{task.status.replace('_', ' ')}</span>
                                            <span style={{ fontSize: '0.9rem', fontWeight: '600', color: '#4f46e5' }}>View →</span>
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
                            <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: '#334155' }}>📌 Obligations</h2>
                            <Link href="/dashboard/obligations" style={{ fontSize: '0.9rem', fontWeight: '500' }}>View All</Link>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {myObligations.length === 0 ? (
                                <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
                                    <p style={{ margin: 0, color: '#94a3b8' }}>No obligations assigned.</p>
                                </div>
                            ) : (
                                myObligations.slice(0, 5).map(ob => (
                                    <Link key={ob.id} href={`/dashboard/obligations/${ob.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                                        <div className="glass-card" style={{ padding: '1.25rem', borderLeft: '4px solid #0ea5e9' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.5rem' }}>
                                                <h3 style={{ fontSize: '1rem', fontWeight: '600', margin: 0 }}>{ob.title}</h3>
                                                <span className="badge" style={{
                                                    background: ob.status === 'COMPLETED' ? '#dcfce7' : '#f0f9ff',
                                                    color: ob.status === 'COMPLETED' ? '#166534' : '#0369a1',
                                                    fontSize: '0.7rem'
                                                }}>
                                                    {ob.status}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Due by {new Date(ob.deadline).toLocaleDateString()}</div>
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

