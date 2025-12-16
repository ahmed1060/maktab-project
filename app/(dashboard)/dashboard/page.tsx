import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"

export default async function DashboardPage({ searchParams }: { searchParams: { company?: string } }) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role

    let companyId: string | undefined = undefined
    if (searchParams.company) {
        const comp = await prisma.company.findUnique({ where: { name: searchParams.company } })
        if (comp) companyId = comp.id
    }

    if (['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        // Super Admin System Overview (when no specific company is selected)
        if (userRole === 'SUPER_ADMIN' && !companyId) {
            const totalCompanies = await prisma.company.count()
            const totalUsers = await prisma.user.count()
            const totalSuperAdmins = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } })
            const totalAdmins = await prisma.user.count({ where: { role: 'ADMIN' } })
            const totalEmployees = await prisma.user.count({ where: { role: 'EMPLOYEE' } })
            const totalTasks = await prisma.task.count()
            const totalObligations = await prisma.obligation.count()
            const totalClients = await prisma.businessClient.count()

            return (
                <div className="animate-fade-in">
                    <header style={{ marginBottom: '2.5rem' }}>
                        <h1 style={{ fontSize: '2rem', fontWeight: '800', color: '#1e293b' }}>
                            System Overview
                        </h1>
                        <p style={{ color: '#64748b', fontSize: '1rem', marginTop: '0.5rem' }}>Complete system statistics across all companies.</p>
                    </header>

                    {/* System Stats Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
                        <div className="glass-card animate-delay-100">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                                <div style={{ fontSize: '0.9rem', opacity: 0.9, fontWeight: '500' }}>Total Companies</div>
                                <span style={{ fontSize: '1.5rem', opacity: 0.8 }}>🏢</span>
                            </div>
                            <div style={{ fontSize: '3rem', fontWeight: '800', lineHeight: 1 }}>{totalCompanies}</div>
                        </div>
                        <div className="glass-card glass-info animate-delay-200">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                                <div style={{ fontSize: '0.9rem', fontWeight: '700' }}>Total Users</div>
                                <span style={{ fontSize: '1.5rem', background: 'rgba(255,255,255,0.4)', padding: '0.5rem', borderRadius: '0.5rem' }}>👥</span>
                            </div>
                            <div style={{ fontSize: '2.5rem', fontWeight: '800' }}>{totalUsers}</div>
                        </div>
                        <div className="glass-card glass-warning animate-delay-200">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                                <div style={{ fontSize: '0.9rem', fontWeight: '700' }}>Total Tasks</div>
                                <span style={{ fontSize: '1.5rem', background: 'rgba(255,255,255,0.4)', padding: '0.5rem', borderRadius: '0.5rem' }}>✅</span>
                            </div>
                            <div style={{ fontSize: '2.5rem', fontWeight: '800' }}>{totalTasks}</div>
                        </div>
                        <div className="glass-card glass-success animate-delay-300">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                                <div style={{ fontSize: '0.9rem', fontWeight: '700' }}>Business Clients</div>
                                <span style={{ fontSize: '1.5rem', background: 'rgba(255,255,255,0.4)', padding: '0.5rem', borderRadius: '0.5rem' }}>🤝</span>
                            </div>
                            <div style={{ fontSize: '2.5rem', fontWeight: '800' }}>{totalClients}</div>
                        </div>
                    </div>

                    {/* User Breakdown */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '3rem' }}>
                        <div className="glass-card animate-delay-300">
                            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem', fontWeight: '700' }}>User Breakdown</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '0.5rem' }}>
                                    <span style={{ fontWeight: '600' }}>Super Admins</span>
                                    <span style={{ fontSize: '1.5rem', fontWeight: '800', color: '#6366f1' }}>{totalSuperAdmins}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'rgba(139, 92, 246, 0.1)', borderRadius: '0.5rem' }}>
                                    <span style={{ fontWeight: '600' }}>Admins</span>
                                    <span style={{ fontSize: '1.5rem', fontWeight: '800', color: '#8b5cf6' }}>{totalAdmins}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '0.5rem' }}>
                                    <span style={{ fontWeight: '600' }}>Employees</span>
                                    <span style={{ fontSize: '1.5rem', fontWeight: '800', color: '#3b82f6' }}>{totalEmployees}</span>
                                </div>
                            </div>
                        </div>

                        <div className="glass-card animate-delay-300">
                            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem', fontWeight: '700' }}>System Activity</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '0.5rem' }}>
                                    <span style={{ fontWeight: '600' }}>Total Obligations</span>
                                    <span style={{ fontSize: '1.5rem', fontWeight: '800', color: '#f59e0b' }}>{totalObligations}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '0.5rem' }}>
                                    <span style={{ fontWeight: '600' }}>Total Tasks</span>
                                    <span style={{ fontSize: '1.5rem', fontWeight: '800', color: '#10b981' }}>{totalTasks}</span>
                                </div>
                            </div>
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
                            <Link href="/dashboard/super-admins" className="btn" style={{ flex: 1, justifyContent: 'center', background: 'rgba(255,255,255,0.4)', color: '#334155', height: '3rem', border: '1px solid rgba(255,255,255,0.5)', minWidth: '200px' }}>
                                Manage Super Admins
                            </Link>
                        </div>
                    </div>
                </div>
            )
        }

        // Regular Admin/Team Leader view (or Super Admin with specific company selected)
        const baseWhere = companyId ? { assignee: { companyId } } : {}

        const totalTasks = await prisma.task.count({ where: baseWhere })
        const pendingTasks = await prisma.task.count({ where: { ...baseWhere, status: 'PENDING' } })
        const submittedTasks = await prisma.task.count({ where: { ...baseWhere, status: 'PENDING_CONFIRMATION' } })
        const completedTasks = await prisma.task.count({ where: { ...baseWhere, status: 'COMPLETED' } })

        return (
            <div className="animate-fade-in">
                <header style={{ marginBottom: '2.5rem' }}>
                    <h1 style={{ fontSize: '2rem', fontWeight: '800', color: '#1e293b' }}>
                        {userRole === 'SUPER_ADMIN' ? 'Super Admin Overview' : userRole === 'TEAM_LEADER' ? 'Team Leader Overview' : 'Admin Overview'}
                    </h1>
                    <p style={{ color: '#64748b', fontSize: '1rem', marginTop: '0.5rem' }}>Here is a high-level summary of all activities.</p>
                </header>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
                    <div className="glass-card animate-delay-100">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                            <div style={{ fontSize: '0.9rem', opacity: 0.9, fontWeight: '500' }}>Total Tasks</div>
                            <span style={{ fontSize: '1.5rem', opacity: 0.8 }}>📊</span>
                        </div>
                        <div style={{ fontSize: '3rem', fontWeight: '800', lineHeight: 1 }}>{totalTasks}</div>
                    </div>
                    <div className="glass-card glass-info animate-delay-200">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                            <div style={{ fontSize: '0.9rem', fontWeight: '700' }}>Pending</div>
                            <span style={{ fontSize: '1.5rem', background: 'rgba(255,255,255,0.4)', padding: '0.5rem', borderRadius: '0.5rem' }}>⏳</span>
                        </div>
                        <div style={{ fontSize: '2.5rem', fontWeight: '800' }}>{pendingTasks}</div>
                    </div>
                    <div className="glass-card glass-warning animate-delay-200">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                            <div style={{ fontSize: '0.9rem', fontWeight: '700' }}>Review Needed</div>
                            <span style={{ fontSize: '1.5rem', background: 'rgba(255,255,255,0.4)', padding: '0.5rem', borderRadius: '0.5rem' }}>📝</span>
                        </div>
                        <div style={{ fontSize: '2.5rem', fontWeight: '800' }}>{submittedTasks}</div>
                    </div>
                    <div className="glass-card glass-success animate-delay-300">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                            <div style={{ fontSize: '0.9rem', fontWeight: '700' }}>Completed</div>
                            <span style={{ fontSize: '1.5rem', background: 'rgba(255,255,255,0.4)', padding: '0.5rem', borderRadius: '0.5rem' }}>✅</span>
                        </div>
                        <div style={{ fontSize: '2.5rem', fontWeight: '800' }}>{completedTasks}</div>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
                    <div className="glass-card animate-delay-300" style={{ height: 'fit-content' }}>
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
                    {/* Placeholder for future charts or recent activity */}
                    <div className="glass-card animate-delay-300" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.2)', borderStyle: 'dashed', minHeight: '200px' }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.5 }}>📈</div>
                            <p style={{ color: '#94a3b8', margin: 0 }}>Activity insights coming soon</p>
                        </div>
                    </div>
                </div>
            </div>
        )
    } else {
        // Employee View
        const myTasks = await prisma.task.findMany({
            where: { assigneeId: (session?.user as any)?.id },
            orderBy: { deadline: 'asc' }
        })

        const myObligations = await prisma.obligation.findMany({
            where: { assigneeId: (session?.user as any)?.id },
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

        const upcomingTasks = myTasks.filter(task => {
            const deadline = new Date(task.deadline)
            deadline.setHours(0, 0, 0, 0)
            return deadline > today && task.status !== 'APPROVED' && task.status !== 'COMPLETED'
        })

        return (
            <div className="animate-fade-in">
                <header style={{ marginBottom: '3rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
                        <div>
                            <h1 style={{ fontSize: '2.25rem', fontWeight: '800', color: '#1e293b', marginBottom: '0.5rem' }}>
                                Hello, {(session?.user as any)?.firstName}! 👋
                            </h1>
                            <p style={{ color: '#64748b', fontSize: '1.1rem' }}>Here's your productive agenda for today.</p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: '500' }}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
                        </div>
                    </div>
                </header>

                {/* Today's Focus */}
                <section style={{ marginBottom: '3rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: '700', margin: 0 }}>🔥 Due Today</h2>
                        {todayTasks.length > 0 && (
                            <span className="badge" style={{ background: '#fee2e2', color: '#dc2626', fontSize: '0.8rem' }}>{todayTasks.length} Urgent</span>
                        )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
                        {todayTasks.length === 0 ? (
                            <div className="glass-card glass-success animate-delay-100" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', padding: '2rem' }}>
                                <div style={{ fontSize: '3rem', background: 'rgba(255,255,255,0.8)', borderRadius: '50%', width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>🎉</div>
                                <div>
                                    <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', fontWeight: '700', color: '#166534' }}>All Caught Up!</h3>
                                    <p style={{ margin: 0, color: '#15803d' }}>You have no pending tasks due today. Great job!</p>
                                </div>
                            </div>
                        ) : (
                            todayTasks.map((task, idx) => (
                                <Link key={task.id} href={`/dashboard/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }} className={`animate-delay-${Math.min((idx + 1) * 100, 500)}`}>
                                    <div className="glass-card" style={{ height: '100%', boxSizing: 'border-box', borderLeft: '6px solid #ef4444', position: 'relative', transition: 'transform 0.2s', padding: '1.75rem' }}>
                                        <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                            <h3 style={{ fontSize: '1.25rem', fontWeight: '700', lineHeight: '1.3', color: '#1e293b' }}>{task.title}</h3>
                                            <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>Today</span>
                                        </div>
                                        <p style={{ color: '#64748b', fontSize: '0.95rem', lineHeight: '1.6', marginBottom: '1.5rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                            {task.description}
                                        </p>
                                        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '1rem' }}>
                                            <span className="badge" style={{ background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0' }}>{task.status.replace('_', ' ')}</span>
                                            <span style={{ fontSize: '0.9rem', fontWeight: '600', color: '#4f46e5', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>View <span style={{ fontSize: '1.2em' }}>→</span></span>
                                        </div>
                                    </div>
                                </Link>
                            ))
                        )}
                    </div>
                </section>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2.5rem', alignItems: 'start' }}>
                    {/* Upcoming */}
                    <section className="animate-delay-200">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: '#334155' }}>📅 Upcoming Work</h2>
                            <Link href="/dashboard/tasks" style={{ fontSize: '0.9rem', fontWeight: '500' }}>View All</Link>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {upcomingTasks.length === 0 ? (
                                <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
                                    <p style={{ color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>No upcoming tasks scheduled.</p>
                                </div>
                            ) : (
                                upcomingTasks.slice(0, 5).map(task => ( // Start with showing 5 max
                                    <Link key={task.id} href={`/dashboard/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                                        <div className="glass-card" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'background 0.2s', borderLeft: '4px solid #cbd5e1' }}>
                                            <div style={{ overflow: 'hidden' }}>
                                                <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '0.35rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</h3>
                                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Due: {new Date(task.deadline).toLocaleDateString()}</span>
                                                    <span className="badge" style={{ fontSize: '0.7rem', background: '#f1f5f9', color: '#475569' }}>{task.status.replace('_', ' ')}</span>
                                                </div>
                                            </div>
                                            <div style={{ color: '#cbd5e1' }}>›</div>
                                        </div>
                                    </Link>
                                ))
                            )}
                        </div>
                    </section>

                    {/* Obligations */}
                    <section className="animate-delay-300">
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

