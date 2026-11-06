'use client'

import { useState, useEffect, useSyncExternalStore } from 'react'
import PageTitle from './PageTitle'
import SubscriptionNote from './SubscriptionNote'
import SideBar from './SideBar'
import { useFeatures } from '@/lib/features/useFeatures'
import { hasBundle } from '@/lib/features/bundles'
import { inNativeApp } from '@/lib/mobile/native'
import AppPush from './AppPush'
import { sideBarFor } from '@/lib/side-bar'
import { useModules } from '@/lib/useModules'
import { useCompanyBranding } from '@/context/CompanyBrandingContext'
import { useCompany } from '@/context/CompanyContext'
import { DEFAULT_POWERED_BY_NAME } from '@/lib/branding-defaults'
import { usePathname, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { WAITING_FOR_REVIEW_KEY } from '@/lib/requests/kinds'
import DashboardHeader from './DashboardHeader'
import { useLanguage } from '@/context/LanguageContext'
import { permissionsOf } from '@/lib/useCan'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import PreviewNote from '@/components/PreviewNote'

interface DashboardShellProps {
    children: React.ReactNode
    user: any // Typed from session
    // Resolved server-side in the dashboard layout from SystemSettings.
    // Defaults true so a caller that does not pass it still shows the mark —
    // attribution should never disappear because a prop was forgotten.
    showPoweredBy?: boolean
    // The name shown in that mark. Falls back to the default rather than to an
    // empty string: "Powered by" with nothing after it reads as a bug.
    poweredByName?: string
    // Whether this person sees their company's settings: resolved in the
    // layout from the company's switch and their role (ATTENDANCE_PLAN.md §5.2).
    showCompanySettings?: boolean
    // Whether their company uses cash advances, for My cash advance and the
    // Costs page's tab (CLIENTS_PLAN.md §7.5): resolved there too.
    cashAdvances?: boolean
}

const subscribeNever = () => () => {}

// A phone's or a tablet's width, where the side bar is a drawer: the same
// query as its CSS (.ui-side-bar in components/ui/ui.css).
const phoneQuery = () => window.matchMedia('(max-width: 1023px)')
const subscribePhone = (onChange: () => void) => {
    const query = phoneQuery()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
}
const isPhoneNow = () => phoneQuery().matches

export default function DashboardShell({ children, user, showPoweredBy = true, poweredByName, showCompanySettings: settingsOnFirstPaint = false, cashAdvances: advancesOnFirstPaint = false }: DashboardShellProps) {
    // The side bar's drawer, on a phone or a tablet (DESIGN.md §5.1). Where the
    // side bar sits is CSS; this is only whether it's a dialog, and open.
    const isPhone = useSyncExternalStore(subscribePhone, isPhoneNow, () => false)
    const [drawerOpen, setDrawerOpen] = useState(false)
    const { t, locale } = useLanguage()
    // The company's package, from the account the layout passed until the
    // session has loaded (useFeatures), so what it leaves out never shows.
    const features = useFeatures()
    // Read once in the browser: the server can't know the page is inside the app.
    const inApp = useSyncExternalStore(subscribeNever, inNativeApp, () => false)
    const modules = useModules()
    // From the user the layout passed down, not the session hook, so the
    // sidebar is complete on the first paint.
    const permissions = permissionsOf(user)
    // Company settings (ATTENDANCE_PLAN.md §5.2): the layout's answer for the
    // first paint, then asked again on every page and on focus. The layout
    // persists across client navigation, so without this the Super Admin's
    // switch would reach an open dashboard only on a full reload. Focus is
    // turned on here: the app's SWRConfig turns it off everywhere else.
    const pathname = usePathname()
    const { data: settingsEntry, mutate: recheckSettings } = useSWR(
        user?.role && user.role !== 'SUPER_ADMIN' ? '/api/company-settings/visible' : null,
        fetcher,
        { fallbackData: { data: { visible: settingsOnFirstPaint, cashAdvances: advancesOnFirstPaint } }, revalidateOnMount: false, revalidateOnFocus: true },
    )
    useEffect(() => { recheckSettings() }, [pathname, recheckSettings])
    const showCompanySettings = !!settingsEntry?.data?.visible
    const groups = sideBarFor({
        superAdmin: user?.role === 'SUPER_ADMIN',
        can: permission => permissions.can(permission),
        // What the package doesn't include isn't there (DESIGN.md §5.1).
        has: gated => features.has(gated),
        // Checking in (ATTENDANCE_PLAN.md §9): only inside the Nizmo app,
        // where the phone can prove where it is.
        checkIn: inApp && hasBundle(features.access, 'ATTENDANCE_MOBILE'),
        companySettings: showCompanySettings,
        cashAdvances: !!settingsEntry?.data?.cashAdvances,
    })
    // How many wait on this person under the Requests page's To review tab,
    // on Requests in the side bar (DESIGN.md §5.1): asked once Requests is
    // there, again on every page, when they come back to the window, and when
    // the Super Admin looks at another company, which the server reads from
    // the cookie picking one writes. The Requests page asks again itself once
    // something there is decided. Only the effect asks on the first paint, as
    // for the settings above.
    const waitingKey = groups.some(g => g.items.includes('requests')) ? WAITING_FOR_REVIEW_KEY : null
    const { selectedCompanyId } = useCompany()
    const { data: waiting, mutate: recheckWaiting } = useSWR<{ data?: { count: number } }>(
        waitingKey,
        fetcher,
        { revalidateOnMount: false, revalidateOnFocus: true },
    )
    useEffect(() => { void recheckWaiting() }, [pathname, waitingKey, selectedCompanyId, recheckWaiting])
    // The mark follows the same scope as the names beside it — a Super Admin
    // looking at one company sees that company's logo, not a default mark over
    // that company's module names.
    const scopedBranding = useCompanyBranding()
    const logoUrl = scopedBranding ? scopedBranding.logoUrl : (user?.logoUrl ?? null)
    const isRtl = locale === 'ar'

    // Closed on another page, and when the window grows past a phone's.
    useAdjustOnChange([pathname, isPhone], () => setDrawerOpen(false))

    const [isScrolled, setIsScrolled] = useState(false)

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 10)
        }
        window.addEventListener('scroll', handleScroll)
        return () => window.removeEventListener('scroll', handleScroll)
    }, [])

    const searchParams = useSearchParams()
    const selectedCompanyName = searchParams.get('company')

    const displayName = user?.role === 'SUPER_ADMIN'
        ? (selectedCompanyName || t('app_name'))
        : (user?.companyName || t('app_name'));

    return (
        // The side bar beside the page on a computer, in its flow, and a
        // drawer over it on a phone: CSS (.ui-side-bar), so the first paint is
        // already right, with no margin kept in step with its width.
        <div style={{ display: 'flex', minHeight: '100vh', background: 'transparent' }}>
            {/* Inside the Nizmo app: pushes on, and a tapped notice opens its page. */}
            {inApp && <AppPush />}
            {/* Renders nothing; sets the browser tab title for the current route.
                Mounted once here rather than per page, because 27 of the 35
                dashboard pages are Client Components and cannot export metadata. */}
            <PageTitle />

            {/* The first thing Tab reaches: past the 10 to 20 sidebar links, to the page itself. */}
            <a href="#main-content" className="skip-link">{t('skip_to_content' as any)}</a>

            {/* Grouped by what people do (UI_PLAN.md §2.1, §2.2), and a group
                with nothing this person may see is left out: lib/side-bar.ts,
                which the Company Settings preview of the side bar reads too. A
                module's name comes from lib/modules.ts, with the company's own,
                and its icon from lib/side-bar-icons.ts, unless the company
                chose its own. A Super Admin, who belongs to no one company,
                sees the defaults (lib/auth.ts). */}
            <SideBar
                groups={groups}
                modules={modules}
                company={{ name: displayName, logoUrl }}
                pathname={pathname}
                drawer={isPhone}
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                waiting={waiting?.data?.count}
            />

            {/* Main Content Wrapper */}
            <main className="shell-main" style={{
                flex: 1,
                // A flex item is never narrower than its content by default,
                // and a header subtitle that cuts off with an ellipsis still
                // counts at full length: a long one widened the whole page.
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                minHeight: '100vh',
                background: 'transparent',
                direction: isRtl ? 'rtl' : 'ltr',
            }}>
                {/* The top bar (DESIGN.md §5.1), at the top as the page scrolls.
                    Past 10px it floats as glass, drawn on the bar inside this
                    frame, which keeps its height: the page under it never moves. */}
                <div className="ui-topbar-frame" data-floating={isScrolled ? 'true' : 'false'}>
                    <DashboardHeader
                        user={user}
                        company={{ name: displayName, logoUrl }}
                        onMenuClick={() => setDrawerOpen(true)}
                        menuOpen={drawerOpen}
                    />
                </div>

                {/* The skip link's target: the page itself, after the header's
                    controls (bell, account menu), which repeat on every page too. */}
                <div id="main-content" tabIndex={-1} className="ui-page-area">
                    {/* Notes above the page (DESIGN.md §5.5), rather than in it,
                        so they're on every screen without each page having to
                        remember. Neither can be closed: each goes when what it
                        says stops being true, and draws nothing until then. */}
                    <PreviewNote preview={user?.preview} />
                    <SubscriptionNote />
                    {children}
                </div>
                {/* Floating Attribution - Minimalist CYSHIELD style.
                    Hidden entirely when switched off in System Settings, not
                    merely made transparent: an invisible element still takes a
                    corner of the screen and still reads out to a screen reader. */}
                {showPoweredBy && (
                <div style={{
                    // In the page on a phone, floating in the corner on a
                    // desktop.
                    //
                    // Fixed, it sat in the viewport's bottom corner at z-index
                    // 100 — above the mobile sidebar (50) and its scrim (49) —
                    // so opening the drawer painted the signature straight
                    // across the navigation behind it. A phone has no spare
                    // corner to float something in, and this is decoration: it
                    // belongs at the end of the page there, not over whatever
                    // happens to be underneath.
                    // Its placement (in the page on a phone, in the corner on a
                    // desktop) is CSS: .floating-attribution in globals.css.
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center', // Centered relative to each other
                    pointerEvents: 'none',
                    transition: 'all 0.3s ease',
                    textAlign: 'center'
                }} className="floating-attribution">
                    <span style={{
                        fontSize: '0.45rem',
                        color: 'var(--text-soft)',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        fontFamily: 'var(--font-inter), sans-serif'
                    }}>
                        {t('powered_by') || 'Powered by'}
                    </span>
                    {/* Faded, the large name only: it is large text (3:1 is
                        enough). "Powered by" is tiny and was 3.0:1 faded. */}
                    <span style={{
                        opacity: 0.7,
                        fontSize: '1.35rem',
                        color: 'var(--text-main)',
                        fontWeight: '900',
                        letterSpacing: '0.15em',
                        marginTop: '0.05rem',
                        textTransform: 'uppercase',
                        fontFamily: 'var(--font-inter), sans-serif',
                        background: 'linear-gradient(135deg, var(--text-main) 0%, var(--text-muted) 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                    }}>
                        {poweredByName?.trim() || DEFAULT_POWERED_BY_NAME}
                    </span>
                </div>
                )}

                <style jsx>{`
                    .floating-attribution:hover {
                        opacity: 1;
                    }
                `}</style>
            </main>
        </div>
    )
}
