'use client'
import { useState, useEffect, useRef, useId, Suspense, type RefObject } from 'react'
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
import CompanyPicker from './CompanyPicker'
import ThemeToggleButton from './ThemeToggleButton'
import useSWR from 'swr'
import { useFeatures } from '@/lib/features/useFeatures'
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
    const accountRef = useRef<HTMLButtonElement>(null)
    const accountBox = useRef<HTMLDivElement>(null)
    const accountMenuId = useId()
    const { t } = useLanguage()
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

    const handleSelectCompany = (val: string | null) => {
        // The address names the last company until the pick lands.
        companyLeftBehind.current = searchParams.get('companyId')
        setSelectedCompanyId(val)

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

    const getRoleKey = (role: string): TranslationKey => {
        switch (role) {
            case 'EMPLOYEE': return 'role_employee'
            case 'TEAM_LEADER': return 'role_team_leader'
            case 'ADMIN': return 'role_admin'
            case 'SUPER_ADMIN': return 'role_super_admin'
            default: return 'role_employee'
        }
    }

    const handleLogout = async () => {
        // This tab's row for who's online goes first (UserHeartbeat): asked
        // after, the session is already over and the server refuses it.
        window.dispatchEvent(new CustomEvent('app:signing-out'))
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

            {/* The Super Admin's company picker, with a search of its own (DESIGN.md §5.1). */}
            {currentUser.role === 'SUPER_ADMIN' && <CompanyPicker companies={companies} inViewId={selectedCompanyId || null} onPick={handleSelectCompany} />}

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
