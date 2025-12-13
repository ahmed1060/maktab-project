import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import UserHeartbeat from "@/components/UserHeartbeat"
import { authOptions } from "@/lib/auth"
import DashboardHeader from "@/components/DashboardHeader"

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
        <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--background)' }}>
            <UserHeartbeat />
            {/* Modern Sidebar */}
            <aside style={{
                width: '260px',
                background: '#1e293b', // Slate 800 - Deep Dark 
                color: 'white',
                display: 'flex',
                flexDirection: 'column',
                position: 'fixed',
                height: '100vh',
                borderRight: '1px solid #334155',
                zIndex: 50
            }}>
                <div style={{
                    padding: '2rem',
                    borderBottom: '1px solid #334155',
                    background: 'linear-gradient(to right, #1e293b, #0f172a)'
                }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: '800', letterSpacing: '-0.025em', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '1.5rem' }}>🚀</span> TaskManager
                    </div>
                </div>

                <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1.5rem 1rem' }}>
                    <p style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', color: '#94a3b8', paddingLeft: '0.75rem', marginBottom: '0.25rem' }}>Menu</p>

                    {[
                        { href: '/dashboard', label: 'Dashboard', icon: '📊' },
                        { href: '/dashboard/tasks', label: 'Tasks', icon: '✅' },
                        { href: '/dashboard/obligations', label: 'Obligations', icon: '📌' },
                    ].map(link => (
                        <Link key={link.href} href={link.href} className="nav-link" style={{
                            color: '#e2e8f0',
                            textDecoration: 'none',
                            padding: '0.75rem 1rem',
                            borderRadius: '0.5rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            transition: 'all 0.2s',
                            fontSize: '0.95rem',
                            fontWeight: '500'
                        }}>
                            <span>{link.icon}</span> {link.label}
                        </Link>
                    ))}

                    {(['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(session.user?.role || '')) && (
                        <>
                            <p style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', color: '#94a3b8', paddingLeft: '0.75rem', marginTop: '1.5rem', marginBottom: '0.25rem' }}>Management</p>

                            {[
                                { href: '/dashboard/costs', label: 'Costs', icon: '💰' },
                                { href: '/dashboard/employees', label: 'Employees', icon: '👥' },
                            ].map(link => (
                                <Link key={link.href} href={link.href} className="nav-link" style={{
                                    color: '#e2e8f0',
                                    textDecoration: 'none',
                                    padding: '0.75rem 1rem',
                                    borderRadius: '0.5rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.75rem',
                                    transition: 'all 0.2s',
                                    fontSize: '0.95rem',
                                    fontWeight: '500'
                                }}>
                                    <span>{link.icon}</span> {link.label}
                                </Link>
                            ))}
                        </>
                    )}

                    {/* SUPER ADMIN ONLY */}
                    {session.user?.role === 'SUPER_ADMIN' && (
                        <>
                            <p style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', color: '#94a3b8', paddingLeft: '0.75rem', marginTop: '1.5rem', marginBottom: '0.25rem' }}>System</p>
                            <Link href="/dashboard/super-admins" className="nav-link" style={{
                                color: '#e2e8f0',
                                textDecoration: 'none',
                                padding: '0.75rem 1rem',
                                borderRadius: '0.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                transition: 'all 0.2s',
                                fontSize: '0.95rem',
                                fontWeight: '500'
                            }}>
                                <span>🛡️</span> Super Admins
                            </Link>
                            <Link href="/dashboard/companies" className="nav-link" style={{
                                color: '#e2e8f0',
                                textDecoration: 'none',
                                padding: '0.75rem 1rem',
                                borderRadius: '0.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                transition: 'all 0.2s',
                                fontSize: '0.95rem',
                                fontWeight: '500'
                            }}>
                                <span>🏢</span> Companies
                            </Link>
                            <Link href="/dashboard/all-users" className="nav-link" style={{
                                color: '#e2e8f0',
                                textDecoration: 'none',
                                padding: '0.75rem 1rem',
                                borderRadius: '0.5rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                transition: 'all 0.2s',
                                fontSize: '0.95rem',
                                fontWeight: '500'
                            }}>
                                <span>👥</span> All Users
                            </Link>
                        </>
                    )}
                </nav>

                <div style={{ marginTop: 'auto', padding: '1.5rem', borderTop: '1px solid #334155' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        &copy; 2025 Maktab Project
                    </div>
                </div>
            </aside>

            {/* Main Content Wrapper */}
            <main style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                marginLeft: '260px', // Offset for fixed sidebar
                minHeight: '100vh',
                background: 'var(--background)'
            }}>
                {/* New Header */}
                <div style={{
                    background: 'white',
                    borderBottom: '1px solid var(--border)',
                    padding: '1rem 2rem',
                    position: 'sticky',
                    top: 0,
                    zIndex: 40,
                    boxShadow: 'var(--shadow-sm)'
                }}>
                    <DashboardHeader user={session.user as any} />
                </div>

                <div style={{ padding: '2rem', maxWidth: '1400px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
                    {children}
                </div>
            </main>
        </div>
    )
}
