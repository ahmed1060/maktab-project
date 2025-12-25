'use client'
import { useState, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { signOut, useSession } from 'next-auth/react'
import Image from 'next/image'
import NotificationBell from './NotificationBell'
import { useCompany } from '@/context/CompanyContext'
import { useHeader } from '@/context/HeaderContext'
import { useLanguage } from '@/context/LanguageContext'
import LanguageToggleButton from './LanguageToggleButton'

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
    const { t, locale } = useLanguage()

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
        if (path === '/dashboard') return t('dashboard')
        if (path === '/dashboard/tasks') return t('tasks')
        if (path.startsWith('/dashboard/tasks/')) return t('task_details')
        if (path === '/dashboard/obligations') return t('obligations')
        if (path.startsWith('/dashboard/obligations/')) return t('obligation_details')
        if (path === '/dashboard/employees') return t('employees')
        if (path.startsWith('/dashboard/employees/')) return t('employee_profile')
        if (path === '/dashboard/costs') return t('costs')
        if (path === '/dashboard/all-users') return t('all_users')
        if (path === '/dashboard/clients') return t('clients')
        if (path.startsWith('/dashboard/clients/')) return t('client_details')
        if (path === '/dashboard/companies') return t('companies')
        if (path === '/dashboard/super-admins') return t('super_admins')
        return t('system')
    }

    const pathTitle = getPageTitle(pathname)
    const title = contextTitle || pathTitle

    const getInitials = (text: string) => {
        if (!text) return ''
        return text
            .split(' ')
            .filter(word => word.length > 0)
            .map(word => word[0])
            .join(' ')
            .toUpperCase()
    }

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
                style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', minWidth: 0, flexShrink: 0 }}
            >
                {currentUser.role === 'SUPER_ADMIN' && (
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        {/* Mobile Initials Mask */}
                        <div className="lg-hidden" style={{
                            position: 'absolute',
                            left: '0',
                            right: '0',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            fontSize: '0.75rem',
                            fontWeight: '800',
                            color: 'var(--text-main)',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            overflow: 'hidden',
                            letterSpacing: '0.05em',
                            zIndex: 2, /* Ensure it's above the select background */
                            pointerEvents: 'none'
                        }}>
                            {selectedCompanyId
                                ? getInitials(companies.find(c => c.id === selectedCompanyId)?.name || '')
                                : getInitials(t('all_companies'))
                            }
                        </div>

                        <select
                            value={selectedCompanyId || ''}
                            onChange={handleCompanyChange}
                            className="glass sm-select input"
                            style={{
                                padding: locale === 'ar' ? '0.5rem 1rem 0.5rem 2.5rem' : '0.5rem 2.5rem 0.5rem 1rem',
                                borderRadius: '1rem',
                                fontSize: '0.9rem',
                                outline: 'none',
                                cursor: 'pointer',
                                color: 'var(--text-main)',
                                flexShrink: 1,
                                minWidth: 0,
                                height: 'auto',
                                textAlign: locale === 'ar' ? 'right' : 'left'
                            }}
                        >
                            <option value="">{t('all_companies')}</option>
                            {companies.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                {['ADMIN', 'SUPER_ADMIN'].includes(currentUser.role) && (
                    <Link
                        href="/dashboard/profile-requests"
                        title={t('profile_requests')}
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
                        onMouseLeave={() => { }}
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

                {/* Avatar area - Grouped for desktop info, but direct child for mobile gap consistency */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {/* User Info - Hidden on mobile, grouped with avatar on desktop */}
                    <div className="md-hidden" style={{ textAlign: 'right', flexShrink: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {currentUser.role.replace('_', ' ')}
                        </div>
                        <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {currentUser.firstName} {currentUser.lastName}
                        </div>
                    </div>

                    {/* Avatar Container with Dropdown */}
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
                                    [locale === 'ar' ? 'left' : 'right']: 0,
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
                                        {t('my_profile')}
                                    </Link>
                                    {currentUser.role !== 'SUPER_ADMIN' && (
                                        <Link
                                            href={`/dashboard/employees/${currentUser.id}/history`}
                                            onClick={() => setIsMenuOpen(false)}
                                            style={{
                                                display: 'block',
                                                padding: '0.5rem 1rem',
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
                                            {t('salary_history')}
                                        </Link>
                                    )}
                                    <LanguageToggleButton variant="menu-item" onAction={() => setIsMenuOpen(false)} />
                                    <button
                                        onClick={handleLogout}
                                        style={{
                                            width: '100%',
                                            textAlign: locale === 'ar' ? 'right' : 'left',
                                            padding: '0.6rem 1rem',
                                            background: 'none',
                                            border: 'none',
                                            color: '#ef4444',
                                            fontSize: '0.9rem',
                                            fontWeight: 'bold',
                                            cursor: 'pointer',
                                            borderRadius: '0.5rem',
                                            transition: 'background 0.2s'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = '#fef2f2'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                        {t('sign_out')}
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
