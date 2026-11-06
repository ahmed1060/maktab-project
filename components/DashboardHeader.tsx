'use client'
import { useState, useEffect, useRef, useId, Suspense, type KeyboardEvent, type RefObject } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { signOut, useSession } from 'next-auth/react'
import { CaretDownIcon, ClockCounterClockwiseIcon, ListIcon, ShieldCheckIcon, SignOutIcon, UserCircleIcon } from '@phosphor-icons/react/ssr'
import type { TranslationKey } from '@/lib/translations'
import NotificationBell from './NotificationBell'
import { addressWithCompanyInView, companyLinkToFollow } from '@/lib/company-link'
import { useCompany } from '@/context/CompanyContext'
import { useLanguage } from '@/context/LanguageContext'
import LanguageToggleButton from './LanguageToggleButton'
import ThemeToggleButton from './ThemeToggleButton'
import useSWR from 'swr'
import { useFeatures } from '@/lib/features/useFeatures'
import { moveOption } from '@/lib/listbox-keys'
import { useBusyAction } from '@/lib/useBusyAction'
import { fetchRetrying } from '@/lib/swr-fetcher'
import { Avatar, CompanyMark, Icon } from '@/components/ui'

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
        companyName?: string | null
    }
    /** The company's name and logo, for its mark at the bar's start on a phone (DESIGN.md §5.1). */
    company: { name: string; logoUrl: string | null }
    onMenuClick?: () => void
    /** Whether the side bar's drawer it opens is open, on a phone (DESIGN.md §5.1). */
    menuOpen?: boolean
}

/** Who is signed in, as the account button and its menu show them (DESIGN.md §5.1). */
export type AccountPerson = {
    id: string
    name: string
    /** Their role, in the words the app uses for roles. */
    role: string
    /** Their company's name; none for the Super Admin, who belongs to no one company. */
    companyName: string | null
    photo: string | null
}

/**
 * The account button at the top bar's end (DESIGN.md §5.1): the person's photo
 * or initials, never a drawing, their name and role, and a caret; on a phone,
 * the photo or initials alone (CSS). Named with all of them, so what it says
 * on screen is in its name.
 */
export function AccountButton({ person, open, menuId, onToggle, buttonRef }: {
    person: AccountPerson
    open: boolean
    menuId: string
    onToggle: () => void
    buttonRef?: RefObject<HTMLButtonElement | null>
}) {
    const { t } = useLanguage()
    return (
        <button type="button" ref={buttonRef} className="ui-topbar-account" aria-expanded={open} aria-controls={open ? menuId : undefined}
            aria-label={t('account_menu_for').replace(/\{(name|role)\}/g, (_, key) => key === 'name' ? person.name : person.role)} onClick={onToggle}>
            <Avatar name={person.name} src={person.photo} size={32} />
            <span className="ui-topbar-who"><span className="ui-topbar-name"><bdi>{person.name}</bdi></span><span className="ui-topbar-role">{person.role}</span></span>
            <Icon icon={CaretDownIcon} size={16} className="ui-topbar-caret" />
        </button>
    )
}

/**
 * The account menu, below the account button (DESIGN.md §5.1): the person at
 * its top, then My profile, Security settings and History where it's offered,
 * the theme switch and Sign out, between hairlines. Not a dialog: its links
 * and buttons are Tab's, and the header closes it.
 */
export function AccountMenuPanel({ id, person, showHistory, onClose, onSignOut, signingOut }: {
    id: string
    person: AccountPerson
    showHistory: boolean
    onClose: () => void
    onSignOut: () => void
    signingOut: boolean
}) {
    const { t } = useLanguage()
    // "Admin at Nile Works", the company's name kept in its own direction.
    const [before, after] = t('account_role_at').replace('{role}', person.role).split('{company}')
    return (
        <div id={id} className="ui-account-menu">
            <div className="ui-account-head">
                <Avatar name={person.name} src={person.photo} size={40} />
                <span className="ui-account-who">
                    <span className="ui-account-name"><bdi>{person.name}</bdi></span>
                    <span className="ui-account-role">{person.companyName ? <>{before}<bdi>{person.companyName}</bdi>{after}</> : person.role}</span>
                </span>
            </div>
            <div className="ui-menu-rule" />
            <Link className="ui-menu-item" href={`/dashboard/employees/${person.id}`} onClick={onClose}><Icon icon={UserCircleIcon} />{t('my_profile')}</Link>
            {/* One entry, not two: both screens answer "how do I get into this account". */}
            <Link className="ui-menu-item" href="/dashboard/security-settings" onClick={onClose}><Icon icon={ShieldCheckIcon} />{t('security_settings_nav')}</Link>
            {showHistory && <Link className="ui-menu-item" href={`/dashboard/employees/${person.id}/history`} onClick={onClose}><Icon icon={ClockCounterClockwiseIcon} />{t('history')}</Link>}
            <div className="ui-menu-rule" />
            {/* Switching theme keeps the menu open: the change is instant and in
                view, and closing on it would hide what was just changed. */}
            <ThemeToggleButton variant="menu-item" />
            <div className="ui-menu-rule" />
            <button type="button" className="ui-menu-item" onClick={onSignOut} disabled={signingOut} aria-busy={signingOut}><Icon icon={SignOutIcon} />{t('sign_out')}</button>
        </div>
    )
}

export default function DashboardHeader({ user, company, onMenuClick, menuOpen = false }: DashboardHeaderProps) {
    const pathname = usePathname()
    const router = useRouter()
    const searchParams = useSearchParams()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const action = useBusyAction()
    const { selectedCompanyId, setSelectedCompanyId, refreshTrigger } = useCompany()
    const [companies, setCompanies] = useState<any[]>([])
    const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0)
    const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false)
    const [isMobile, setIsMobile] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const switcherRef = useRef<HTMLButtonElement>(null)
    const accountRef = useRef<HTMLButtonElement>(null)
    const accountBox = useRef<HTMLDivElement>(null)
    const optionRefs = useRef<(HTMLLIElement | null)[]>([])
    const switcherListId = useId()
    const accountMenuId = useId()
    const { t, locale } = useLanguage()
    // Their own history is HR's: in the menu only where the package includes it.
    const features = useFeatures()

    // Use client-side session for live updates (e.g. avatar change), fall back to prop
    const { data: session } = useSession()
    const currentUser = session?.user || user
    const [headerAvatar, setHeaderAvatar] = useState<string | null>(currentUser.avatar || currentUser.image || currentUser.picture || null)
    const lastProcessedCompany = useRef<string | null | undefined>(undefined)
    // The company a pick in the switcher has just left in the address, until
    // the address changes (lib/company-link.ts).
    const companyLeftBehind = useRef<string | null>(null)

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

                // Unread notifications. What waits to be reviewed is counted on
                // Requests in the side bar (DESIGN.md §5.1).
                if (data.counts) {
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
        // A link that names its company (?companyId=), from a company's
        // attendance settings or a face check's notice, puts it in view
        // (Attendance part 2). Before the name below, which the address may
        // still carry for the company the link takes the page away from.
        if (searchParams.get('companyId') !== companyLeftBehind.current) companyLeftBehind.current = null
        const follow = companyLinkToFollow({ pathname, linked: searchParams.get('companyId'), known: companies.map(c => c.id), leftBehind: companyLeftBehind.current })
        if (follow) {
            const moving = follow !== selectedCompanyId
            if (moving) setSelectedCompanyId(follow)
            // Followed once, and taken out of the address (lib/company-link.ts),
            // even when its company is in view already (review on PR 148).
            const name = companies.find(c => c.id === follow)?.name
            lastProcessedCompany.current = name
            router.replace(`${pathname}?${addressWithCompanyInView(searchParams.toString(), name)}`)
            if (moving) router.refresh()
            return
        }

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
        // The address names the last company until the pick lands.
        companyLeftBehind.current = searchParams.get('companyId')
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

    // Their own history is HR's: in the menu only where the package includes it.
    const showHistory = features.has('PAYROLL') && !['ADMIN', 'SUPER_ADMIN'].includes(currentUser.role)
    const person: AccountPerson = {
        id: currentUser.id,
        name: `${currentUser.firstName} ${currentUser.lastName}`.trim(),
        role: t(getRoleKey(currentUser.role)),
        companyName: currentUser.role === 'SUPER_ADMIN' ? null : (user.companyName ?? null),
        photo: headerAvatar,
    }

    // The account menu closes on a click or a tap outside it (DESIGN.md §5.1).
    useEffect(() => {
        if (!isMenuOpen) return
        const outside = (e: PointerEvent) => { if (!accountBox.current?.contains(e.target as Node)) setIsMenuOpen(false) }
        document.addEventListener('pointerdown', outside)
        return () => document.removeEventListener('pointerdown', outside)
    }, [isMenuOpen])

    // No title: every page names itself in its page header (DESIGN.md §5.1).
    // On a phone, the menu button and the company's mark are at the start (CSS).
    return (
        <header className="ui-topbar">
            {onMenuClick && (
                <button type="button" className="ui-topbar-button ui-topbar-menu" aria-label={t('open_menu')} aria-haspopup="dialog" aria-expanded={menuOpen} onClick={onMenuClick}>
                    <Icon icon={ListIcon} className="ui-topbar-icon" />
                </button>
            )}
            <span className="ui-topbar-mark"><CompanyMark name={company.name} logoUrl={company.logoUrl} /></span>

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

            <span className="ui-topbar-spacer" />
            <LanguageToggleButton />
            <Suspense fallback={<span className="ui-topbar-button" aria-hidden="true" />}>
                <NotificationBell initialUnreadCount={unreadNotificationsCount} />
            </Suspense>
            {/* Escape closes the menu from anywhere in it, the button included:
                right after Enter opens it, focus is still on the button. Tab
                past its last control closes it too. */}
            <div ref={accountBox} className="ui-account"
                onKeyDown={e => { if (e.key === 'Escape') { setIsMenuOpen(false); accountRef.current?.focus() } }}
                onBlur={e => { if (e.relatedTarget && !accountBox.current?.contains(e.relatedTarget as Node)) setIsMenuOpen(false) }}>
                <AccountButton person={person} open={isMenuOpen} menuId={accountMenuId} onToggle={() => setIsMenuOpen(open => !open)} buttonRef={accountRef} />
                {isMenuOpen && (
                    <AccountMenuPanel id={accountMenuId} person={person} showHistory={showHistory} onClose={() => setIsMenuOpen(false)}
                        onSignOut={() => action.run('logout', handleLogout)} signingOut={!!action.is('logout')} />
                )}
            </div>
        </header>
    )
}
