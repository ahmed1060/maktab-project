import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
export default async function DashboardPage({ searchParams }: { searchParams: { companyId?: string } }) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role
    const companyId = searchParams.companyId

    if (['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        const baseWhere = companyId ? { assignee: { companyId } } : {}

        const totalTasks = await prisma.task.count({ where: baseWhere })
        const pendingTasks = await prisma.task.count({ where: { ...baseWhere, status: 'PENDING' } })
        const submittedTasks = await prisma.task.count({ where: { ...baseWhere, status: 'PENDING_CONFIRMATION' } })
        const completedTasks = await prisma.task.count({ where: { ...baseWhere, status: 'COMPLETED' } })

        return (
            <div>
                <h1 style={{ marginBottom: '2rem', fontSize: '1.875rem', fontWeight: '800' }}>
                    {userRole === 'TEAM_LEADER' ? 'Team Leader Overview' : 'Admin Overview'}
                </h1>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
                    <div className="card" style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)', color: 'white', border: 'none' }}>
                        <div style={{ fontSize: '0.875rem', opacity: 0.9, marginBottom: '0.5rem' }}>Total Tasks</div>
                        <div style={{ fontSize: '2.5rem', fontWeight: '800' }}>{totalTasks}</div>
                    </div>
                    <div className="card" style={{ background: 'white' }}>
                        <div style={{ color: '#64748b', fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>Pending</div>
                        <div style={{ fontSize: '2.5rem', fontWeight: '800', color: '#0f172a' }}>{pendingTasks}</div>
                    </div>
                    <div className="card" style={{ background: 'white' }}>
                        <div style={{ color: '#64748b', fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>Submitted (Review)</div>
                        <div style={{ fontSize: '2.5rem', fontWeight: '800', color: '#d97706' }}>{submittedTasks}</div>
                    </div>
                    <div className="card" style={{ background: 'white' }}>
                        <div style={{ color: '#64748b', fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' }}>Completed & Paid</div>
                        <div style={{ fontSize: '2.5rem', fontWeight: '800', color: '#16a34a' }}>{completedTasks}</div>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                    <div className="card">
                        <h3 style={{ marginBottom: '1.5rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem' }}>Quick Actions</h3>
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            <Link href="/dashboard/tasks/new" className="btn btn-primary">
                                + Create Task
                            </Link>
                            <Link href="/dashboard/employees/new" className="btn" style={{ background: '#e2e8f0', color: '#1e293b' }}>
                                + Add Employee
                            </Link>
                        </div>
                    </div>
                    {/* Placeholder for future charts or recent activity */}
                    <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', borderStyle: 'dashed' }}>
                        <p style={{ color: '#94a3b8' }}>Activity Chart Coming Soon</p>
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
            <div>
                <header style={{ marginBottom: '3rem' }}>
                    <h1 style={{ fontSize: '2rem', fontWeight: '800', color: '#1e293b' }}>
                        Welcome back, {(session?.user as any)?.firstName}! 👋
                    </h1>
                    <p style={{ color: '#64748b', fontSize: '1.1rem' }}>Here is what's on your plate for today.</p>
                </header>

                {/* Today's Focus */}
                <section style={{ marginBottom: '3rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: '700', margin: 0 }}>🔥 Due Today</h2>
                        <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>{todayTasks.length} Tasks</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                        {todayTasks.length === 0 ? (
                            <div className="card" style={{ background: '#f0fdf4', border: '1px dashed #86efac', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <span style={{ fontSize: '2rem' }}>🎉</span>
                                <div>
                                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>All Clear!</h3>
                                    <p style={{ margin: 0, color: '#166534' }}>You have no deadlines for today.</p>
                                </div>
                            </div>
                        ) : (
                            todayTasks.map(task => (
                                <Link key={task.id} href={`/dashboard/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                                    <div className="card" style={{ height: '100%', boxSizing: 'border-box', borderLeft: '5px solid #ef4444', position: 'relative' }}>
                                        <div style={{ marginBottom: '1rem' }}>
                                            <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c', marginBottom: '0.5rem' }}>Due Today</span>
                                            <h3 style={{ fontSize: '1.25rem', fontWeight: '600', lineHeight: '1.4' }}>{task.title}</h3>
                                        </div>
                                        <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.5rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                            {task.description}
                                        </p>
                                        <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '1rem' }}>
                                            <span className="badge" style={{ background: '#f1f5f9', color: '#475569' }}>{task.status.replace('_', ' ')}</span>
                                            <span style={{ fontSize: '0.875rem', fontWeight: '500', color: '#4f46e5' }}>View Details →</span>
                                        </div>
                                    </div>
                                </Link>
                            ))
                        )}
                    </div>
                </section>

                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '2rem', alignItems: 'start' }}>
                    {/* Upcoming */}
                    <section>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1rem', color: '#334155' }}>📅 Upcoming Work</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {upcomingTasks.length === 0 ? (
                                <p style={{ color: '#94a3b8', fontStyle: 'italic' }}>No upcoming tasks scheduled.</p>
                            ) : (
                                upcomingTasks.map(task => (
                                    <Link key={task.id} href={`/dashboard/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                                        <div className="card" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '0.25rem' }}>{task.title}</h3>
                                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                                    <span style={{ fontSize: '0.875rem', color: '#64748b' }}>Due: {new Date(task.deadline).toLocaleDateString()}</span>
                                                    <span className="badge" style={{ fontSize: '0.7rem', background: '#f1f5f9' }}>{task.status.replace('_', ' ')}</span>
                                                </div>
                                            </div>
                                            <div style={{ color: '#cbd5e1' }}>chevron_right</div>
                                        </div>
                                    </Link>
                                ))
                            )}
                        </div>
                    </section>

                    {/* Obligations */}
                    <section>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '1rem', color: '#334155' }}>📌 Obligations</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {myObligations.length === 0 ? (
                                <div className="card" style={{ background: '#f8fafc', padding: '1.5rem', textAlign: 'center' }}>
                                    <p style={{ margin: 0, color: '#94a3b8' }}>No obligations assigned.</p>
                                </div>
                            ) : (
                                myObligations.map(ob => (
                                    <Link key={ob.id} href={`/dashboard/obligations/${ob.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                                        <div className="card" style={{ padding: '1.25rem', borderLeft: '3px solid #0ea5e9' }}>
                                            <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '0.5rem' }}>{ob.title}</h3>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>By {new Date(ob.deadline).toLocaleDateString()}</span>
                                                <span className="badge" style={{
                                                    background: ob.status === 'COMPLETED' ? '#dcfce7' : '#f0f9ff',
                                                    color: ob.status === 'COMPLETED' ? '#166534' : '#0369a1'
                                                }}>
                                                    {ob.status}
                                                </span>
                                            </div>
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

