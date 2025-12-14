'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import DashboardHeader from './DashboardHeader'

interface DashboardShellProps {
    children: React.ReactNode
    user: any // Typed from session
}

export default function DashboardShell({ children, user }: DashboardShellProps) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false)
    const [isMobile, setIsMobile] = useState(false)

    // Handle responsive state matches
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 1024) // Tablets and below
            if (window.innerWidth >= 1024) setIsSidebarOpen(true)
            else setIsSidebarOpen(false)
        }

        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    const [isScrolled, setIsScrolled] = useState(false)

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 10)
        }
        window.addEventListener('scroll', handleScroll)
        return () => window.removeEventListener('scroll', handleScroll)
    }, [])

    return (
        <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--background)' }}>
            {/* Sidebar Overlay for Mobile */}
            {isMobile && isSidebarOpen && (
                <div
                    onClick={() => setIsSidebarOpen(false)}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        zIndex: 49,
                        backdropFilter: 'blur(2px)'
                    }}
                />
            )}

            {/* Sidebar */}
            <aside style={{
                width: '260px',
                background: '#1e293b',
                color: 'white',
                display: 'flex',
                flexDirection: 'column',
                position: 'fixed',
                height: '100vh',
                borderRight: '1px solid #334155',
                zIndex: 50,
                transition: 'transform 0.3s ease-in-out',
                transform: isSidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
                boxShadow: isSidebarOpen ? '4px 0 24px rgba(0,0,0,0.1)' : 'none'
            }}>
                <div style={{
                    height: '72px',
                    padding: '0 2rem',
                    borderBottom: '1px solid #334155',
                    background: 'linear-gradient(to right, #1e293b, #0f172a)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxSizing: 'border-box'
                }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: '800', letterSpacing: '-0.025em', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '1.5rem' }}>🚀</span> TaskManager
                    </div>
                    {isMobile && (
                        <button
                            onClick={() => setIsSidebarOpen(false)}
                            style={{ background: 'none', border: 'none', color: 'white', fontSize: '1.5rem', cursor: 'pointer' }}
                        >
                            ×
                        </button>
                    )}
                </div>

                <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1.5rem 1rem', overflowY: 'auto' }}>
                    <p style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', color: '#94a3b8', paddingLeft: '0.75rem', marginBottom: '0.25rem' }}>Menu</p>

                    {[
                        { href: '/dashboard', label: 'Dashboard', icon: '📊' },
                        { href: '/dashboard/tasks', label: 'Tasks', icon: '✅' },
                        { href: '/dashboard/obligations', label: 'Obligations', icon: '📌' },
                    ].map(link => (
                        <Link
                            key={link.href}
                            href={link.href}
                            onClick={() => isMobile && setIsSidebarOpen(false)}
                            className="nav-link"
                            style={{
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

                    {(['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(user?.role || '')) && (
                        <>
                            <p style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', color: '#94a3b8', paddingLeft: '0.75rem', marginTop: '1.5rem', marginBottom: '0.25rem' }}>Management</p>

                            {[
                                { href: '/dashboard/costs', label: 'Costs', icon: '💰' },
                                { href: '/dashboard/employees', label: 'Employees', icon: '👥' },
                            ].map(link => (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    onClick={() => isMobile && setIsSidebarOpen(false)}
                                    className="nav-link"
                                    style={{
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
                    {user?.role === 'SUPER_ADMIN' && (
                        <>
                            <p style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', color: '#94a3b8', paddingLeft: '0.75rem', marginTop: '1.5rem', marginBottom: '0.25rem' }}>System</p>
                            <Link href="/dashboard/super-admins" onClick={() => isMobile && setIsSidebarOpen(false)} className="nav-link" style={{
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
                            <Link href="/dashboard/companies" onClick={() => isMobile && setIsSidebarOpen(false)} className="nav-link" style={{
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
                            <Link href="/dashboard/all-users" onClick={() => isMobile && setIsSidebarOpen(false)} className="nav-link" style={{
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
                marginLeft: (!isMobile) ? '260px' : '0', // Offset only on desktop
                minHeight: '100vh',
                background: 'var(--background)',
                width: '100%',
                transition: 'margin-left 0.3s ease-in-out'
            }}>
                {/* New Header */}
                <div style={{
                    background: isScrolled ? 'rgba(255, 255, 255, 0.8)' : 'transparent',
                    borderBottom: isScrolled ? '1px solid var(--border)' : 'none',
                    position: 'sticky',
                    top: 0,
                    zIndex: 40,
                    boxShadow: isScrolled ? 'var(--shadow-sm)' : 'none',
                    backdropFilter: isScrolled ? 'blur(12px)' : 'none',
                    transition: 'all 0.3s ease'
                }}>
                    <DashboardHeader
                        user={user}
                        onMenuClick={() => setIsSidebarOpen(true)}
                    />
                </div>

                <div style={{ padding: '2rem', maxWidth: '1400px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
                    {children}
                </div>
            </main>
        </div>
    )
}
