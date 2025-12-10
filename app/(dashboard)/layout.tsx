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
            </aside>
            <main style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--secondary)' }}>
                {/* New Header */}
                <DashboardHeader user={session.user as any} />

                <div style={{ padding: '2rem', flex: 1 }}>
                    {children}
                </div>
            </main>
        </div>
    )
}
