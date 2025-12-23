'use client'
import { useState, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { signOut, useSession } from 'next-auth/react'
import Image from 'next/image'
import NotificationBell from './NotificationBell'
import { useCompany } from '@/context/CompanyContext'
import { useHeader } from '@/context/HeaderContext'

interface DashboardHeaderProps {
    user: {
        id: string
        firstName: string
        lastName: string
        role: string
        avatar?: string | null
        image?: string | null
        picture?: string | null
        gender: string
    }
    onMenuClick?: () => void
}

export default function DashboardHeader({ user, onMenuClick }: DashboardHeaderProps) {
    const pathname = usePathname()
    const router = useRouter()
    const searchParams = useSearchParams()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const { selectedCompanyId, setSelectedCompanyId, refreshTrigger } = useCompany()
    const { title: contextTitle } = useHeader()
    const [companies, setCompanies] = useState<{ id: string, name: string }[]>([])
    const [pendingRequestsCount, setPendingRequestsCount] = useState(0)

    // Use client-side session for live updates (e.g. avatar change), fall back to prop
    const { data: session } = useSession()
    const currentUser = session?.user || user
    const [headerAvatar, setHeaderAvatar] = useState<string | null>(currentUser.avatar || currentUser.image || currentUser.picture || null)

    // Precisely like the profile page: Fetch "Ground Truth" on mount and on session changes
    useEffect(() => {
        const fetchGroundTruth = async () => {
            if (!currentUser.id) return
            try {
                const res = await fetch(`/api/users?id=${currentUser.id}`, { cache: 'no-store' })
                if (res.ok) {
                    const data = await res.json()
                    // Fallback through all possible field names returned by API
                    setHeaderAvatar(data.avatar || data.image || data.picture || null)
                }
            } catch (err) {
                console.error('Header sync error:', err)
            }
        }
        fetchGroundTruth()
    }, [currentUser.id, session?.user?.image, session?.user?.avatar, session?.user?.picture])

    useEffect(() => {
        if (currentUser.role === 'SUPER_ADMIN') {
            fetch('/api/companies', { cache: 'no-store' })
                .then(res => res.json())
                .then(data => setCompanies(data))
                .catch(err => console.error('Failed to fetch companies', err))
        }

        if (['ADMIN', 'SUPER_ADMIN'].includes(currentUser.role)) {
            fetch('/api/profile-requests?status=PENDING', { cache: 'no-store' })
                .then(res => res.json())
                .then(data => setPendingRequestsCount(data.length))
                .catch(err => console.error('Failed to fetch profile requests', err))

            // Trigger Note Expiry Check
            fetch('/api/notes/check-expiry', { method: 'POST' }).catch(() => { })
        }
    }, [currentUser.role, refreshTrigger])

    // Sync URL <-> Context
    useEffect(() => {
        const companyNameFromUrl = searchParams.get('company')

        if (companyNameFromUrl && companies.length > 0) {
            // URL has priority
            // Find company by name
            const matchingCompany = companies.find(c => c.name === companyNameFromUrl)
            if (matchingCompany && matchingCompany.id !== selectedCompanyId) {
                setSelectedCompanyId(matchingCompany.id)
            }
        } else if (selectedCompanyId && companies.length > 0) {
            // URL is missing param, but we have a selection (persistence)
            // Re-apply the param to the current URL
            const matchingCompany = companies.find(c => c.id === selectedCompanyId)
            if (matchingCompany) {
                const params = new URLSearchParams(searchParams ? searchParams.toString() : '')
                params.set('company', matchingCompany.name)
                // Remove legacy ID param if exists to be clean
                params.delete('companyId')

                // Only replace if the URL actually needs changing
                const currentName = searchParams.get('company')
                if (currentName !== matchingCompany.name) {
                    router.replace(`${pathname}?${params.toString()}`)
                }
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams, pathname, router, companies])

    const handleCompanyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value
        setSelectedCompanyId(val || null)

        const params = new URLSearchParams(searchParams ? searchParams.toString() : '')
        if (val) {
            const selectedCompany = companies.find(c => c.id === val)
            if (selectedCompany) {
                params.set('company', selectedCompany.name)
            }
            params.delete('companyId')
        } else {
            params.delete('company')
            params.delete('companyId')
        }
        router.push(`${pathname}?${params.toString()}`)
    }

    // Map path to title
    const getPageTitle = (path: string) => {
        if (path === '/dashboard') return 'Dashboard'
        if (path === '/dashboard/tasks') return 'Tasks'
        if (path.startsWith('/dashboard/tasks/')) return 'Task Details'
        if (path === '/dashboard/obligations') return 'Obligations'
        if (path.startsWith('/dashboard/obligations/')) return 'Obligation Details'
        if (path === '/dashboard/employees') return 'Employees'
        if (path.startsWith('/dashboard/employees/')) return 'Employee Profile'
        if (path === '/dashboard/costs') return 'Costs'
        if (path === '/dashboard/all-users') return 'All Users'
        if (path === '/dashboard/clients') return 'Clients'
        if (path.startsWith('/dashboard/clients/')) return 'Client Details'
        if (path === '/dashboard/companies') return 'Companies'
        if (path === '/dashboard/super-admins') return 'Super Admins'
        return 'System'
    }

    const pathTitle = getPageTitle(pathname)
    const title = contextTitle || pathTitle

    const handleLogout = async () => {
        await signOut({ redirect: false })
        router.push('/login')
    }

    return (
        <header
            className="mobile-padding"
            style={{
                padding: '0 2rem',
                background: 'transparent',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                height: '72px',
                width: '100%',
                boxSizing: 'border-box'
            }}
        >
            {/* Left: Page Name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {onMenuClick && (
                    <button
                        onClick={onMenuClick}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            fontSize: '1.5rem',
                            cursor: 'pointer',
                            padding: '0.25rem',
                            lineHeight: 1,
                            color: 'var(--text-main)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                        className="lg-hidden"
                    >
                        ☰
                    </button>
                )}
                <h1 style={{
                    fontSize: 'clamp(1rem, 4vw, 1.5rem)',
                    fontWeight: 'bold',
                    margin: 0,
                    color: 'var(--text-main)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                }}>
                    {title}
                </h1>
            </div>

            {/* Right: Actions & Profile */}
            <div
                className="mobile-gap-dense"
                style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0, flexShrink: 0 }}
            >
                {currentUser.role === 'SUPER_ADMIN' && (
                    <select
                        value={selectedCompanyId || ''}
                        onChange={handleCompanyChange}
                        className="glass sm-select" // Use glass class and responsive sm-select
                        style={{
                            padding: '0.4rem 0.75rem',
                            borderRadius: '1rem',
                            marginRight: currentUser.role === 'SUPER_ADMIN' ? '0' : '0.5rem',
                            fontSize: '0.85rem',
                            outline: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-main)',
                            flexShrink: 1,
                            minWidth: 0
                        }}
                    >
                        <option value="">All Companies</option>
                        {companies.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                )}

                {['ADMIN', 'SUPER_ADMIN'].includes(currentUser.role) && (
                    <Link
                        href="/dashboard/profile-requests"
                        title="Name Change Requests"
                        className="xs-hidden" // Hides on very small screens to save space
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '40px',
                            height: '40px',
                            borderRadius: '12px',
                            background: pathname === '/dashboard/profile-requests' ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255,255,255,0.5)',
                            border: '1px solid rgba(255,255,255,0.8)',
                            color: pathname === '/dashboard/profile-requests' ? '#6366f1' : 'var(--text-main)',
                            textDecoration: 'none',
                            transition: 'all 0.2s',
                            position: 'relative'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.8)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = pathname === '/dashboard/profile-requests' ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255,255,255,0.5)'}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <polyline points="16 11 18 13 22 9"></polyline>
                        </svg>
                        {pendingRequestsCount > 0 && (
                            <span style={{
                                position: 'absolute',
                                top: '-5px',
                                right: '-5px',
                                background: '#ef4444',
                                color: 'white',
                                fontSize: '0.7rem',
                                fontWeight: 'bold',
                                minWidth: '18px',
                                height: '18px',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                border: '2px solid white',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                            }}>
                                {pendingRequestsCount}
                            </span>
                        )}
                    </Link>
                )}

                <NotificationBell />

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {/* User Info (Role Top, Name Bottom) - Hidden on mobile for space */}
                    <div className="md-hidden" style={{ textAlign: 'right', flexShrink: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {currentUser.role.replace('_', ' ')}
                        </div>
                        <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {currentUser.firstName} {currentUser.lastName}
                        </div>
                    </div>

                    {/* Avatar with Dropdown */}
                    <div style={{ position: 'relative' }}>
                        <div
                            onClick={() => setIsMenuOpen(!isMenuOpen)}
                            style={{
                                width: '45px',
                                height: '45px',
                                borderRadius: '50%',
                                background: 'rgba(255,255,255,0.5)',
                                border: '2px solid rgba(255,255,255,0.8)',
                                overflow: 'hidden',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
                                position: 'relative'
                            }}
                        >

                            {headerAvatar ? (
                                <Image
                                    src={headerAvatar}
                                    alt="Profile"
                                    width={45}
                                    height={45}
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                            ) : (
                                <span style={{ fontSize: '1.5rem' }}>{currentUser.gender === 'FEMALE' ? '👩🏻' : '👨🏻'}</span>
                            )}
                        </div>

                        {/* Dropdown Menu */}
                        {isMenuOpen && (
                            <>
                                {/* Backdrop to close on click outside */}
                                <div
                                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                                    onClick={() => setIsMenuOpen(false)}
                                />
                                <div className="glass" style={{
                                    position: 'absolute',
                                    top: '120%',
                                    right: 0,
                                    width: '200px',
                                    zIndex: 100,
                                    padding: '0.5rem',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.5rem'
                                }}>
                                    <Link
                                        href={`/dashboard/employees/${currentUser.id}`}
                                        onClick={() => setIsMenuOpen(false)}
                                        style={{
                                            display: 'block',
                                            padding: '0.6rem 1rem',
                                            textDecoration: 'none',
                                            color: 'var(--text-main)',
                                            fontSize: '0.9rem',
                                            borderRadius: '0.5rem',
                                            transition: 'background 0.2s',
                                            fontWeight: '500'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.4)'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                        My Profile
                                    </Link>
                                    {currentUser.role !== 'SUPER_ADMIN' && (
                                        <Link
                                            href={`/dashboard/employees/${currentUser.id}/history`}
                                            onClick={() => setIsMenuOpen(false)}
                                            style={{
                                                display: 'block',
                                                padding: '0.5rem 1rem',
                                                textDecoration: 'none',
                                                color: '#1e293b',
                                                fontSize: '0.9rem',
                                                borderRadius: '0.25rem',
                                                transition: 'background 0.2s'
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                        >
                                            Salary History
                                        </Link>
                                    )}
                                    <button
                                        onClick={handleLogout}
                                        style={{
                                            width: '100%',
                                            textAlign: 'left',
                                            padding: '0.5rem 1rem',
                                            background: 'none',
                                            border: 'none',
                                            color: '#ef4444',
                                            fontSize: '0.9rem',
                                            fontWeight: 'bold',
                                            cursor: 'pointer',
                                            borderRadius: '0.25rem'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = '#fef2f2'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                        Sign Out
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </header>
    )
}
