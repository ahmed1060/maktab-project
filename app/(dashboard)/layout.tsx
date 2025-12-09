import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import LogoutButton from "@/components/LogoutButton"
import NotificationBell from "@/components/NotificationBell"
import UserHeartbeat from "@/components/UserHeartbeat"
import { authOptions } from "@/lib/auth"

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const session = await getServerSession(authOptions)
    if (!session) {
        redirect('/login')
    }

    return (
        <div style={{ display: 'flex', minHeight: '100vh' }}>
            <UserHeartbeat />
            <aside style={{ width: '250px', background: 'var(--primary)', color: 'white', padding: '1rem', display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '2rem' }}>Task Manager</div>
                <nav style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <Link href="/dashboard" style={{ color: 'white', textDecoration: 'none' }}>Dashboard</Link>
                    <Link href="/dashboard/tasks" style={{ color: 'white', textDecoration: 'none' }}>Tasks</Link>
                    {(['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(session.user?.role || '')) && (
                        <Link href="/dashboard/costs" style={{ color: 'white', textDecoration: 'none' }}>Costs</Link>
                    )}
                    <Link href="/dashboard/obligations" style={{ color: 'white', textDecoration: 'none' }}>Obligations</Link>
                    {(['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(session.user?.role || '')) && (
                        <Link href="/dashboard/employees" style={{ color: 'white', textDecoration: 'none' }}>Employees</Link>
                    )}
                </nav>
                <div style={{ marginTop: 'auto' }}>
                    <div style={{ marginBottom: '1rem', fontSize: '0.875rem', opacity: 0.9 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontWeight: 'bold' }}>{session.user?.firstName}</div>
                                <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '0.25rem' }}>
                                    {session.user?.role?.replace('_', ' ')}
                                </div>
                            </div>
                            <Link
                                href={`/dashboard/employees/${session.user?.id}`}
                                style={{ marginLeft: '0.5rem', textDecoration: 'none' }}
                            >
                                <div style={{
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '50%',
                                    background: '#e2e8f0',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    overflow: 'hidden',
                                    border: '2px solid white',
                                    cursor: 'pointer'
                                }}>
                                    {session.user?.avatar ? (
                                        <img
                                            src={session.user?.avatar}
                                            alt="Profile"
                                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                        />
                                    ) : (
                                        <span style={{ fontSize: '1.25rem' }}>
                                            {session.user?.gender === 'FEMALE' ? '👩🏻' : '👨🏻'}
                                        </span>
                                    )}
                                </div>
                            </Link>
                        </div>
                    </div>
                    <LogoutButton />
                </div>
            </aside>
            <main style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--secondary)' }}>
                <header style={{
                    padding: '1rem 2rem',
                    background: 'white',
                    borderBottom: '1px solid #eee',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end'
                }}>
                    <NotificationBell />
                </header>
                <div style={{ padding: '2rem', flex: 1 }}>
                    {children}
                </div>
            </main>
        </div>
    )
}
