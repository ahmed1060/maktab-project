import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import ObligationCard from "@/components/ObligationCard"

export default async function DashboardPage() {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role

    if (['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        const totalTasks = await prisma.task.count()
        const pendingTasks = await prisma.task.count({ where: { status: 'PENDING' } })
        const submittedTasks = await prisma.task.count({ where: { status: 'SUBMITTED' } })

        return (
            <div>
                <h1 style={{ marginBottom: '1.5rem' }}>
                    {userRole === 'TEAM_LEADER' ? 'Team Leader Dashboard' : 'Admin Dashboard'}
                </h1>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                    <div className="card">
                        <h3>Total Tasks</h3>
                        <p style={{ fontSize: '2rem', fontWeight: 'bold' }}>{totalTasks}</p>
                    </div>
                    <div className="card">
                        <h3>Pending</h3>
                        <p style={{ fontSize: '2rem', fontWeight: 'bold' }}>{pendingTasks}</p>
                    </div>
                    <div className="card">
                        <h3>Submitted</h3>
                        <p style={{ fontSize: '2rem', fontWeight: 'bold' }}>{submittedTasks}</p>
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
            return deadline <= today && task.status !== 'APPROVED'
        })

        const upcomingTasks = myTasks.filter(task => {
            const deadline = new Date(task.deadline)
            deadline.setHours(0, 0, 0, 0)
            return deadline > today && task.status !== 'APPROVED'
        })

        return (
            <div>
                <h1 style={{ marginBottom: '1.5rem' }}>My Dashboard</h1>

                {/* Today's Tasks Section */}
                <h2 style={{ marginTop: '2rem', marginBottom: '1rem', color: '#dc2626' }}>Today's Tasks</h2>
                <div style={{ display: 'grid', gap: '1rem' }}>
                    {todayTasks.length === 0 ? (
                        <p>No tasks due today.</p>
                    ) : (
                        todayTasks.map(task => (
                            <div key={task.id} className="card" style={{ borderLeft: '4px solid #dc2626' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                    <div>
                                        <Link href={`/dashboard/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                                            <h3 className="hover-shadow" style={{ cursor: 'pointer' }}>
                                                {task.title}
                                            </h3>
                                        </Link>
                                        <p style={{ color: '#64748b', margin: '0.5rem 0' }}>{task.description}</p>
                                    </div>
                                    <span style={{ padding: '0.25rem 0.5rem', borderRadius: '0.25rem', background: '#fee2e2', color: '#991b1b', fontSize: '0.875rem' }}>
                                        {new Date(task.deadline).toLocaleDateString()}
                                    </span>
                                </div>
                                <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{
                                        fontSize: '0.75rem',
                                        fontWeight: '600',
                                        padding: '0.25rem 0.75rem',
                                        borderRadius: '9999px',
                                        background: task.status === 'APPROVED' ? '#dcfce7' : task.status === 'REJECTED' ? '#fee2e2' : '#f1f5f9',
                                        color: task.status === 'APPROVED' ? '#166534' : task.status === 'REJECTED' ? '#991b1b' : '#475569',
                                        display: 'inline-flex',
                                        alignItems: 'center'
                                    }}>
                                        {task.status}
                                    </span>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Upcoming Tasks Section */}
                <h2 style={{ marginTop: '2rem', marginBottom: '1rem' }}>Upcoming Tasks</h2>
                <div style={{ display: 'grid', gap: '1rem' }}>
                    {upcomingTasks.length === 0 ? (
                        <p>No upcoming tasks.</p>
                    ) : (
                        upcomingTasks.map(task => (
                            <div key={task.id} className="card">
                                <Link href={`/dashboard/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                                    <h3 className="hover-shadow" style={{ cursor: 'pointer' }}>
                                        {task.title}
                                    </h3>
                                </Link>
                                <p>{task.description}</p>
                                <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{
                                        fontSize: '0.75rem',
                                        fontWeight: '600',
                                        padding: '0.25rem 0.75rem',
                                        borderRadius: '9999px',
                                        background: task.status === 'APPROVED' ? '#dcfce7' : task.status === 'REJECTED' ? '#fee2e2' : '#f1f5f9',
                                        color: task.status === 'APPROVED' ? '#166534' : task.status === 'REJECTED' ? '#991b1b' : '#475569',
                                        display: 'inline-flex',
                                        alignItems: 'center'
                                    }}>
                                        {task.status}
                                    </span>
                                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.875rem', color: '#64748b' }}>{new Date(task.deadline).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Obligations Section */}
                <h2 style={{ marginTop: '2rem', marginBottom: '1rem' }}>My Obligations</h2>
                <div style={{ display: 'grid', gap: '1rem' }}>
                    {myObligations.length === 0 ? (
                        <p>No obligations assigned.</p>
                    ) : (
                        myObligations.map(obligation => (
                            <div key={obligation.id} className="card">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                    <Link href={`/dashboard/obligations/${obligation.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                                        <h3 className="hover-shadow" style={{ cursor: 'pointer' }}>
                                            {obligation.title}
                                        </h3>
                                    </Link>
                                    <span style={{
                                        fontSize: '0.75rem',
                                        fontWeight: '600',
                                        padding: '0.25rem 0.75rem',
                                        borderRadius: '9999px',
                                        background: obligation.status === 'COMPLETED' ? '#dcfce7' : obligation.status === 'REJECTED' ? '#fee2e2' : '#f1f5f9',
                                        color: obligation.status === 'COMPLETED' ? '#166534' : obligation.status === 'REJECTED' ? '#991b1b' : '#475569',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        flexShrink: 0
                                    }}>
                                        {obligation.status}
                                    </span>
                                </div>
                                <p>{obligation.description}</p>
                                <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
                                        Deadline: {new Date(obligation.deadline).toLocaleDateString()}
                                    </span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        )
    }
}
