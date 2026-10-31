'use client'
import { useState, useEffect, useRef, useId, Suspense, type KeyboardEvent } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { signOut, useSession } from 'next-auth/react'
import Image from 'next/image'
import type { TranslationKey } from '@/lib/translations'
import NotificationBell from './NotificationBell'
import { useCompany } from '@/context/CompanyContext'
import { useHeader } from '@/context/HeaderContext'
import { useLanguage } from '@/context/LanguageContext'
import { useModules } from '@/lib/useModules'
import LanguageToggleButton from './LanguageToggleButton'
import ThemeToggleButton from './ThemeToggleButton'
import useSWR from 'swr'
import { permissionsOf } from '@/lib/useCan'
import { moveOption } from '@/lib/listbox-keys'
import { useBusyAction } from '@/lib/useBusyAction'
import { fetchRetrying } from '@/lib/swr-fetcher'

// Fetcher for SWR
const fetcher = (url: string) => fetchRetrying(url, { cache: 'no-store' }).then(res => res.json())

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
    const action = useBusyAction()
    const { selectedCompanyId, setSelectedCompanyId, refreshTrigger } = useCompany()
    const { title: contextTitle, subtitle: contextSubtitle } = useHeader()
    const modules = useModules()
    const [companies, setCompanies] = useState<any[]>([])
    const [pendingRequestsCount, setPendingRequestsCount] = useState(0)
    const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0)
    const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false)
    const [isMobile, setIsMobile] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const switcherRef = useRef<HTMLButtonElement>(null)
    const accountRef = useRef<HTMLButtonElement>(null)
    const optionRefs = useRef<(HTMLLIElement | null)[]>([])
    const switcherListId = useId()
    const accountMenuId = useId()
    const { t, locale } = useLanguage()

    // Use client-side session for live updates (e.g. avatar change), fall back to prop
    const { data: session } = useSession()
    const currentUser = session?.user || user
    const [headerAvatar, setHeaderAvatar] = useState<string | null>(currentUser.avatar || currentUser.image || currentUser.picture || null)
    const lastProcessedCompany = useRef<string | null | undefined>(undefined)

    // Using SWR for data fetching with deduplication
    const { mutate } = useSWR(
        currentUser.id ? '/api/me/bootstrap' : null,
        fetcher,
        {
            dedupingInterval: 300000,
            revalidateOnFocus: false,
            onSuccess: (res) => {
                const data = res.data
                if (!data) return

                // Update Avatar
                const userAvatar = data.user?.avatar || data.user?.image || data.user?.picture || null
                setHeaderAvatar(userAvatar)

                // Update Companies if Super Admin
                if (data.companies && Array.isArray(data.companies)) {
                    setCompanies(data.companies)
                }

                // Update Pending Requests Count & Notifications
                if (data.counts) {
                    setPendingRequestsCount(data.counts.pendingProfileRequests || 0)
                    setUnreadNotificationsCount(data.counts.unreadNotifications || 0)
                }

            }
        }
    )

    // Force re-validation when trigger or profile changes
    useEffect(() => {
        if (refreshTrigger > 0 || session?.user?.image || session?.user?.avatar || session?.user?.picture) {
            mutate()
        }
    }, [refreshTrigger, session?.user?.image, session?.user?.avatar, session?.user?.picture, mutate])

    // Sync URL <-> Context
    useEffect(() => {
        const companyNameFromUrl = searchParams.get('company')

        // If the URL matches what we last processed (manually or via sync), 
        // we skip to avoid race conditions between Context update and Route update.
        if (companyNameFromUrl === lastProcessedCompany.current) return

        if (companyNameFromUrl && companies.length > 0) {
            // URL has priority
            // Find company by name
            const matchingCompany = companies.find(c => c.name === companyNameFromUrl)
            if (matchingCompany && matchingCompany.id !== selectedCompanyId) {
                setSelectedCompanyId(matchingCompany.id)
                // A deep link into another company: the server already rendered
                // this page against whatever the scope cookie said before that
                // call rewrote it, so the sidebar would be describing the wrong
                // company. Safe against looping because the guard above only
                // lets this run when the selection actually changed, and the
                // early return at the top of the effect covers the re-run.
                router.refresh()
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

        lastProcessedCompany.current = companyNameFromUrl
    }, [searchParams, pathname, router, companies, selectedCompanyId, setSelectedCompanyId])

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 1024)
        checkMobile()
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsCompanyDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const handleSelectCompany = (val: string | null) => {
        setSelectedCompanyId(val)
        setIsCompanyDropdownOpen(false)

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

        // Update ref to current URL value immediately.
        // This prevents the sync useEffect from seeing the "old" URL and 
        // overriding our new context selection before the router has finished updating the URL.
        lastProcessedCompany.current = searchParams.get('company')
        router.push(`${pathname}?${params.toString()}`)
        // setSelectedCompanyId has just rewritten the scope cookie, and the
        // dashboard layout reads that cookie on the server. Without this the
        // sidebar would keep the previous company's names until something else
        // caused a server render — refresh() re-runs the layout while leaving
        // client state alone, which is what makes the switch land everywhere at
        // once rather than in two visible steps.
        router.refresh()
    }

    // The company switcher, by keyboard as well as by mouse (WAI-ARIA listbox):
    // the arrows, Home and End move between companies, Enter or Space picks
    // one, Escape closes and goes back to the switcher, Tab closes and moves on.
    const switcherOptions: { id: string | null; name: string }[] = [
        { id: null, name: t('all_companies') },
        ...companies.map(c => ({ id: c.id as string, name: c.name as string })),
    ]
    const selectedOption = Math.max(0, switcherOptions.findIndex(o => o.id === (selectedCompanyId || null)))
    const openSwitcher = () => {
        setIsCompanyDropdownOpen(true)
        // After the list is drawn: start on the company in view.
        setTimeout(() => optionRefs.current[selectedOption]?.focus(), 0)
    }
    const onSwitcherKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            openSwitcher()
        }
    }
    const pickOption = (i: number) => {
        handleSelectCompany(switcherOptions[i].id)
        switcherRef.current?.focus()
    }
    const onOptionKeyDown = (e: KeyboardEvent<HTMLLIElement>, i: number) => {
        const next = moveOption(i, e.key, switcherOptions.length)
        if (next !== null) {
            e.preventDefault()
            optionRefs.current[next]?.focus()
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            pickOption(i)
        } else if (e.key === 'Escape') {
            e.preventDefault()
            setIsCompanyDropdownOpen(false)
            switcherRef.current?.focus()
        } else if (e.key === 'Tab') {
            setIsCompanyDropdownOpen(false)
        }
    }

    // Map path to title. A module's own landing page takes this company's name
    // for it; the detail pages underneath keep their own translated headings
    // ("Task Details" stays "Task Details" whatever Tasks was renamed to,
    // because it names the record, not the module).
    const getPageTitle = (path: string) => {
        if (path === '/dashboard') return modules.label('dashboard')
        if (path === '/dashboard/tasks') return modules.label('tasks')
        if (path.startsWith('/dashboard/tasks/')) return t('task_details')
        if (path === '/dashboard/obligations') return modules.label('obligations')
        if (path.startsWith('/dashboard/obligations/')) return t('obligation_details')
        if (path === '/dashboard/employees') return modules.label('employees')
        if (path.startsWith('/dashboard/employees/')) return t('employee_profile')
        if (path === '/dashboard/costs') return modules.label('costs')
        if (path === '/dashboard/clients') return modules.label('clients')
        if (path === '/dashboard/all-users') return t('all_users')
        if (path.startsWith('/dashboard/clients/')) return t('client_page_title')
        if (path.startsWith('/dashboard/records')) return modules.label('records')
        if (path === '/dashboard/companies') return t('companies')
        if (path === '/dashboard/super-admins') return t('super_admins')
        if (path === '/dashboard/requests') return modules.label('requests')
        if (path === '/dashboard/requests/history') return t('requests_history')
        if (path === '/dashboard/usernames') return t('usernames_list')
        // Named here as well as set by the page, because the page deliberately
        // sets no header while the email gate is up — without this the fallback
        // below would title that screen "System".
        if (path === '/dashboard/security-settings') return t('security_settings_nav')
        return t('system')
    }

    const getRoleKey = (role: string): TranslationKey => {
        switch (role) {
            case 'EMPLOYEE': return 'role_employee'
            case 'TEAM_LEADER': return 'role_team_leader'
            case 'ADMIN': return 'role_admin'
            case 'SUPER_ADMIN': return 'role_super_admin'
            default: return 'role_employee'
        }
    }

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

    const pathTitle = getPageTitle(pathname)
    const title = contextTitle || pathTitle

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
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: 1 }}>
                {onMenuClick && (
                    <button aria-label={t('open_menu' as any)}
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
                        <span aria-hidden="true">☰</span>
                    </button>
                )}
                {/* minWidth: 0 again here — the floor applies at every level of
                    the flex chain, so lifting it only on the row above leaves
                    this wrapper refusing to shrink and the title still running
                    under the buttons. */}
                <div className="ui-topbar-title" style={{ minWidth: 0, flex: 1 }}>
                    <h1 style={{
                        fontSize: 'clamp(1rem, 4.5vw, 1.4rem)',
                        fontWeight: '800',
                        margin: 0,
                        color: 'var(--text-main)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        lineHeight: 1.2
                    }}>
                        {title}
                    </h1>
                    {contextSubtitle && !isMobile && (
                        <p style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-muted)',
                            margin: 0,
                            fontWeight: '500',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            marginTop: '0.1rem'
                        }}>
                            {contextSubtitle}
                        </p>
                    )}
                </div>
            </div>

            {/* Right: Actions & Profile */}
            <div
                className="mobile-gap-dense"
                style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', minWidth: 0, flexShrink: 0 }}
            >
                {currentUser.role === 'SUPER_ADMIN' && (
                    <div ref={dropdownRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <button
                            type="button"
                            ref={switcherRef}
                            onClick={() => isCompanyDropdownOpen ? setIsCompanyDropdownOpen(false) : openSwitcher()}
                            onKeyDown={onSwitcherKeyDown}
                            aria-haspopup="listbox"
                            aria-expanded={isCompanyDropdownOpen}
                            aria-controls={isCompanyDropdownOpen ? switcherListId : undefined}
                            aria-label={t('company_switcher_label' as TranslationKey).replace('{name}', switcherOptions[selectedOption].name)}
                            className="glass sm-select"
                            style={{
                                fontFamily: 'inherit',
                                padding: locale === 'ar' ? '0.5rem 1.5rem 0.5rem 2.5rem' : '0.5rem 2.5rem 0.5rem 1.5rem',
                                borderRadius: '1rem',
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                background: 'var(--veil-40)',
                                border: '1px solid var(--veil-60)',
                                transition: 'all 0.2s ease',
                                color: 'var(--text-main)',
                                minWidth: '130px',
                                maxWidth: '200px',
                                textAlign: 'center',
                                fontWeight: '600',
                                boxShadow: '0 2px 4px var(--shadow-faint)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                position: 'relative'
                            }}
                        >
                            <span style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                display: isMobile ? 'none' : 'block'
                            }}>
                                {selectedCompanyId
                                    ? (companies.find(c => c.id === selectedCompanyId)?.name || t('all_companies'))
                                    : t('all_companies')
                                }
                            </span>

                            {/* Mobile Initials */}
                            {isMobile && (
                                <span style={{ fontSize: '0.75rem', fontWeight: '800' }}>
                                    {selectedCompanyId
                                        ? getInitials(companies.find(c => c.id === selectedCompanyId)?.name || '')
                                        : getInitials(t('all_companies'))
                                    }
                                </span>
                            )}

                            {!isMobile && (
                                <span style={{
                                    position: 'absolute',
                                    [locale === 'ar' ? 'left' : 'right']: '0.75rem',
                                    transform: isCompanyDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                    transition: 'transform 0.2s',
                                    display: 'flex',
                                    alignItems: 'center'
                                }}>
                                    <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="6 9 12 15 18 9"></polyline>
                                    </svg>
                                </span>
                            )}
                        </button>

                        {isCompanyDropdownOpen && (
                            <ul
                                id={switcherListId}
                                role="listbox"
                                aria-label={t('select_company')}
                                tabIndex={-1}
                                style={{
                                    listStyle: 'none',
                                    margin: 0,
                                    position: 'absolute',
                                    top: 'calc(100% + 8px)',
                                    [locale === 'ar' ? 'left' : 'right']: 0,
                                    background: 'var(--surface)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '0.75rem',
                                    boxShadow: '0 10px 15px -3px var(--shadow-weak), 0 4px 6px -2px var(--shadow-faint)',
                                    zIndex: 1000,
                                    maxHeight: '300px',
                                    overflowY: 'auto',
                                    minWidth: '200px',
                                    padding: '0.5rem'
                                }}
                            >
                                {switcherOptions.map((option, i) => {
                                    const selected = i === selectedOption
                                    return (
                                        <li
                                            key={option.id ?? 'all'}
                                            ref={el => { optionRefs.current[i] = el }}
                                            role="option"
                                            aria-selected={selected}
                                            tabIndex={-1}
                                            onClick={() => pickOption(i)}
                                            onKeyDown={e => onOptionKeyDown(e, i)}
                                            style={{
                                                padding: '0.625rem 1rem',
                                                cursor: 'pointer',
                                                fontSize: '0.875rem',
                                                borderRadius: '0.5rem',
                                                color: selected ? 'var(--info-solid-hover)' : 'var(--text-muted)',
                                                background: selected ? 'var(--info-bg-subtle)' : 'transparent',
                                                fontWeight: selected ? 600 : 500,
                                                marginBottom: '2px',
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center'
                                            }}
                                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-sunk)'}
                                            onMouseLeave={(e) => e.currentTarget.style.background = selected ? 'var(--info-bg-subtle)' : 'transparent'}
                                        >
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {option.name}
                                            </span>
                                            {selected && option.id && (
                                                <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--info-solid-hover)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="20 6 9 17 4 12"></polyline>
                                                </svg>
                                            )}
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </div>
                )}

                {/* Profile Name Requests Counter (for whoever decides them), opening them on the Requests page (UI_PLAN.md §2.3, part 5a) */}
                {permissionsOf(currentUser as any).can('profile_requests.review') && (
                    <Suspense fallback={<div style={{ width: '45px', height: '45px', borderRadius: '50%', background: 'var(--veil-20)' }} />}>
                        <Link
                            href="/dashboard/requests?tab=review&kind=nameChange&show=waiting"
                            title={t('profile_name_requests')}
                            aria-label={t('profile_name_requests')}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '45px',
                                height: '45px',
                                borderRadius: '50%',
                                background: 'var(--veil-50)',
                                border: '2px solid var(--panel-80)',
                                color: 'var(--text-main)',
                                position: 'relative',
                                transition: 'all 0.2s ease',
                                boxShadow: '0 4px 6px var(--shadow-faint)'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'scale(1.05)'
                                e.currentTarget.style.background = 'var(--panel-80)'
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'scale(1)'
                                e.currentTarget.style.background = 'var(--veil-50)'
                            }}
                        >
                            <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="8.5" cy="7" r="4"></circle>
                                <polyline points="17 11 19 13 23 9"></polyline>
                            </svg>
                            {pendingRequestsCount > 0 && (
                                <span style={{
                                    position: 'absolute',
                                    top: '-5px',
                                    right: '-5px',
                                    background: 'var(--danger-fill)',
                                    color: 'var(--text-on-accent)',
                                    fontSize: '0.7rem',
                                    fontWeight: 'bold',
                                    minWidth: '18px',
                                    height: '18px',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    border: '2px solid white',
                                    boxShadow: '0 2px 4px var(--shadow-weak)'
                                }}>
                                    {pendingRequestsCount}
                                </span>
                            )}
                        </Link>
                    </Suspense>
                )}

                <Suspense fallback={<div style={{ width: '24px', height: '24px' }} />}>
                    <NotificationBell initialUnreadCount={unreadNotificationsCount} />
                </Suspense>

                {/* Avatar area - Grouped for desktop info, but direct child for mobile gap consistency */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {/* User Info - Hidden on mobile, grouped with avatar on desktop */}
                    <div className="md-hidden" style={{ textAlign: locale === 'ar' ? 'left' : 'right', flexShrink: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {t(getRoleKey(currentUser.role))}
                        </div>
                        <div style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {currentUser.firstName} {currentUser.lastName}
                        </div>
                    </div>

                    {/* Avatar Container with Dropdown. Escape closes the menu
                        from anywhere in it, the button included: right after
                        Enter opens it, focus is still on the button. */}
                    <div style={{ position: 'relative' }} onKeyDown={e => {
                        if (e.key === 'Escape' && isMenuOpen) { setIsMenuOpen(false); accountRef.current?.focus() }
                    }}>
                        {/* A button, so the keyboard can open the account menu too. */}
                        <button
                            type="button"
                            ref={accountRef}
                            onClick={() => setIsMenuOpen(!isMenuOpen)}
                            aria-expanded={isMenuOpen}
                            aria-controls={isMenuOpen ? accountMenuId : undefined}
                            aria-label={t('account_menu' as TranslationKey)}
                            style={{
                                padding: 0,
                                width: '45px',
                                height: '45px',
                                borderRadius: '50%',
                                background: 'var(--veil-50)',
                                border: '2px solid var(--panel-80)',
                                overflow: 'hidden',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 4px 6px var(--shadow-faint)',
                                position: 'relative'
                            }}
                        >

                            {headerAvatar ? (
                                <Image
                                    src={headerAvatar}
                                    alt=""
                                    width={45}
                                    height={45}
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                            ) : (
                                <span aria-hidden="true" style={{ fontSize: '1.5rem' }}>{currentUser.gender === 'FEMALE' ? '👩🏻' : '👨🏻'}</span>
                            )}
                        </button>

                        {/* Dropdown Menu */}
                        {isMenuOpen && (
                            <>
                                {/* Backdrop to close on click outside */}
                                <div
                                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
                                    onClick={() => setIsMenuOpen(false)}
                                />
                                <div id={accountMenuId} className="glass" style={{
                                    position: 'absolute',
                                    top: '120%',
                                    [locale === 'ar' ? 'left' : 'right']: 0,
                                    // As wide as its widest row (the theme and language
                                    // switches), at least 200px, never wider than the
                                    // screen. A fixed 200px cut the theme switch off.
                                    width: 'max-content',
                                    minWidth: 'min(200px, calc(100vw - 3rem))',
                                    maxWidth: 'calc(100vw - 3rem)',
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
                                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--veil-40)'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                        {t('my_profile')}
                                    </Link>
                                    {/* One entry, not two: both screens were
                                        answers to "how do I get into this
                                        account", and they now live together. */}
                                    <Link
                                        href="/dashboard/security-settings"
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
                                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--veil-40)'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                        {t('security_settings_nav')}
                                    </Link>
                                    {!['ADMIN', 'SUPER_ADMIN'].includes(currentUser.role) && (
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
                                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--veil-40)'}
                                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                        >
                                            {t('history')}
                                        </Link>
                                    )}
                                    <LanguageToggleButton variant="menu-item" onAction={() => setIsMenuOpen(false)} />
                                    {/* No onAction, unlike the language row: switching
                                        theme is instant and visible, so closing the
                                        menu on the click would hide the thing you
                                        just changed and make comparing the two a
                                        round trip. Language closes it because the
                                        whole page reloads behind an overlay anyway. */}
                                    <ThemeToggleButton variant="menu-item" />
                                    <button
                                        onClick={() => action.run('logout', handleLogout)}
                                        disabled={action.running}
                                        aria-busy={action.is('logout')}
                                        style={{
                                            width: '100%',
                                            textAlign: locale === 'ar' ? 'right' : 'left',
                                            padding: '0.6rem 1rem',
                                            background: 'none',
                                            border: 'none',
                                            color: 'var(--danger-fg-strong)',
                                            fontSize: '0.9rem',
                                            fontWeight: 'bold',
                                            cursor: 'pointer',
                                            borderRadius: '0.5rem',
                                            transition: 'background 0.2s'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--danger-bg-subtle)'}
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
