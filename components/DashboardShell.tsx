'use client'

import { useState, useEffect } from 'react'
import PageTitle from './PageTitle'
import SubscriptionBanner from './SubscriptionBanner'
import { moduleForPagePath } from '@/lib/features'
import { useFeatures } from '@/lib/features/useFeatures'
import { MANAGEMENT_MODULES, MENU_MODULES, type ModuleKey } from '@/lib/modules'
import { useModules } from '@/lib/useModules'
import { useCompanyBranding } from '@/context/CompanyBrandingContext'
import { DEFAULT_POWERED_BY_NAME } from '@/lib/branding-defaults'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import DashboardHeader from './DashboardHeader'
import { useLanguage } from '@/context/LanguageContext'
import { permissionsOf } from '@/lib/useCan'
import type { Permission } from '@/lib/permissions/catalogue'
import PreviewBanner from '@/components/PreviewBanner'

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
}

/**
 * Who is offered each management screen: the permission its page needs. A
 * management module with no entry here is offered to nobody, so adding one
 * means deciding who sees it.
 */
const MANAGEMENT_PERMISSION: Partial<Record<ModuleKey, Permission>> = {
    costs: 'tasks.pay',
    employees: 'employees.view',
    vendors: 'vendors.view',
}

export default function DashboardShell({ children, user, showPoweredBy = true, poweredByName }: DashboardShellProps) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false)
    const [isMobile, setIsMobile] = useState(false)
    const [isCollapsed, setIsCollapsed] = useState(false) // New State for Desktop Collapse
    const { t, locale } = useLanguage()
    const features = useFeatures()
    const modules = useModules()
    // From the user the layout passed down, not the session hook, so the
    // sidebar is complete on the first paint.
    const permissions = permissionsOf(user)
    const managementLinks = MANAGEMENT_MODULES
        .filter(key => {
            const permission = MANAGEMENT_PERMISSION[key]
            return !!permission && permissions.can(permission)
        })
        .map(key => modules.entry(key))
    const canSeePayroll = permissions.can('payroll.view')
    // Role requests (ROLES_PLAN.md §6.12): for whoever decides them, and
    // whoever makes them.
    const canSeeRoleRequests = user?.role !== 'SUPER_ADMIN' && (permissions.can('employees.assign_role') || permissions.can('employees.request_role'))
    // The mark follows the same scope as the names beside it — a Super Admin
    // looking at one company sees that company's logo, not a default mark over
    // that company's module names.
    const scopedBranding = useCompanyBranding()
    const logoUrl = scopedBranding ? scopedBranding.logoUrl : (user?.logoUrl ?? null)
    const isRtl = locale === 'ar'

    // Handle responsive state matches
    useEffect(() => {
        const checkMobile = () => {
            const mobile = window.innerWidth < 1024
            setIsMobile(mobile)
            if (mobile) {
                setIsSidebarOpen(false)
                setIsCollapsed(false) // Reset collapse on mobile
            } else {
                setIsSidebarOpen(true)
                // Keep existing collapsed state on desktop resize or default to false
            }
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

    // Dynamic width based on state
    const sidebarWidth = isMobile ? '270px' : (isCollapsed ? '80px' : '270px')

    const searchParams = useSearchParams()
    const selectedCompanyName = searchParams.get('company')

    const displayName = user?.role === 'SUPER_ADMIN'
        ? (selectedCompanyName || t('app_name'))
        : (user?.companyName || t('app_name'));

    // A module the package does not include stays in the sidebar, marked with a
    // lock, and still navigates. That is the point: it is the sales surface, and
    // the page it lands on is what records the attempt. Hiding it instead would
    // mean nobody ever discovers what else the product does — and would make the
    // signal in LockedModuleAttempt impossible to gather.
    const isLockedHref = (href: string) => {
        // Not named `module`: Next forbids assigning that identifier, since it
        // collides with the CommonJS global in some bundling paths.
        const gated = moduleForPagePath(href)
        return gated !== null && !features.has(gated)
    }

    return (
        <div style={{ display: 'flex', minHeight: '100vh', background: 'transparent' }}>
            {/* Renders nothing; sets the browser tab title for the current route.
                Mounted once here rather than per page, because 27 of the 35
                dashboard pages are Client Components and cannot export metadata. */}
            <PageTitle />

            {/* Sidebar Overlay for Mobile */}
            {isMobile && isSidebarOpen && (
                <div
                    onClick={() => setIsSidebarOpen(false)}
                    style={{
                        position: 'fixed', inset: 0,
                        backgroundColor: 'var(--scrim)',
                        backdropFilter: 'blur(4px)',
                        zIndex: 49
                    }}
                />
            )}

            {/* Glass Sidebar */}
            <aside className="glass-dark" style={{
                width: sidebarWidth,
                display: 'flex',
                flexDirection: 'column',
                position: 'fixed',
                height: '100vh',
                zIndex: 50,
                transition: 'width 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                [isRtl ? 'right' : 'left']: 0,
                transform: (isMobile && !isSidebarOpen) ? (isRtl ? 'translateX(100%)' : 'translateX(-100%)') : 'translateX(0)',
                boxShadow: (isMobile && isSidebarOpen) ? (isRtl ? '-20px 0 50px var(--shadow-mid)' : '20px 0 50px var(--shadow-mid)') : 'none',
                overflow: 'hidden',
                direction: isRtl ? 'rtl' : 'ltr'
            }}>
                <div style={{
                    minHeight: (user?.role === 'SUPER_ADMIN') ? '70px' : '55px',
                    paddingInlineStart: isCollapsed ? '0' : '1.25rem',
                    paddingInlineEnd: isCollapsed ? '0' : '0.75rem',
                    paddingTop: (user?.role === 'SUPER_ADMIN' ? '0.25rem' : 0),
                    display: 'flex',
                    justifyContent: isCollapsed ? 'center' : 'flex-start',
                    alignItems: 'center',
                    transition: 'all 0.4s ease',
                    width: '100%',
                    boxSizing: 'border-box',
                    position: 'relative'
                }}>
                    <div
                        onClick={() => !isMobile && setIsCollapsed(!isCollapsed)}
                        style={{
                            fontSize: '1.5rem',
                            fontWeight: '800',
                            letterSpacing: '-0.025em',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            color: 'var(--text-on-accent)',
                            whiteSpace: 'nowrap',
                            overflow: 'visible',
                            cursor: !isMobile ? 'pointer' : 'default',
                            flex: 1,
                            minWidth: 0, // Allow shrinking to prevent overflow
                            width: 'auto'
                        }}
                        title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                    >
                        <span style={{
                            fontSize: '1.4rem',
                            filter: 'drop-shadow(0 2px 4px var(--shadow-weak))',
                            width: isCollapsed ? '100%' : 'auto',
                            display: 'flex',
                            justifyContent: 'center',
                            flexShrink: 0,
                            marginLeft: (!isCollapsed && locale === 'en') ? '0.8rem' : '0',
                            marginRight: (!isCollapsed && locale === 'ar') ? '0.8rem' : '0',
                            transition: 'all 0.3s ease'
                        }}>
                            {logoUrl ? (
                                /* On a plate, always, in both themes — and the plate is
                                   not a dark-mode concession. This sidebar is dark in
                                   light mode too (--sidebar-bg is slate-900 at 65%), so
                                   a logo with a baked-in white background was already a
                                   white rectangle here before dark mode existed, and a
                                   dark-ink logo on a transparent background would be
                                   invisible on it either way. Requiring transparency
                                   would trade one of those failures for the other; a
                                   light plate is the only thing that renders every
                                   customer's logo the same way in both themes.
                                   eslint-disable-next-line @next/next/no-img-element —
                                   next/image would need every customer's Supabase host
                                   in next.config, and this is one small image. */
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={logoUrl}
                                    alt=""
                                    style={{
                                        width: '2rem',
                                        height: '2rem',
                                        objectFit: 'contain',
                                        background: 'var(--logo-plate)',
                                        borderRadius: '0.45rem',
                                        padding: '0.15rem',
                                        boxSizing: 'border-box',
                                    }}
                                />
                            ) : '🚀'}
                        </span>
                        {!isCollapsed && (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center', // Centered horizontally
                                justifyContent: 'center',
                                flex: 1,
                                position: 'relative',
                                padding: '0.4rem 0.25rem 0.5rem 0.25rem',
                                boxSizing: 'border-box',
                                width: '100%',
                                overflow: 'hidden',
                                textAlign: 'left'
                            }}>
                                {(() => {
                                    const cleanName = displayName.trim();
                                    const isArabicName = /[\u0600-\u06FF]/.test(cleanName);
                                    const isAppTitle = cleanName === t('app_name');
                                    const words = cleanName.split(/\s+/);
                                    const isTwoWords = words.length === 2 && !isAppTitle;

                                    // Case 1: 1 word
                                    // Case 2: 2 words -> Part 1 = Word 1, Part 2 = Word 2 (Diagonal)
                                    // Case 3: 3+ words -> Part 1 = All but last, Part 2 = Last word (Centered)
                                    const part1 = words.length > 1 ? words.slice(0, -1).join(' ') : words[0] || '';
                                    const part2 = words.length > 1 ? words.slice(-1)[0] : '';

                                    const nameLength = cleanName.length;
                                    const textStyle: React.CSSProperties = {
                                        background: 'linear-gradient(to right, var(--surface), var(--info-border-indigo))',
                                        WebkitBackgroundClip: 'text',
                                        WebkitTextFillColor: 'transparent',
                                        fontSize: nameLength > 20
                                            ? 'clamp(0.9rem, 1.4vw, 1.2rem)'
                                            : nameLength > 12
                                                ? 'clamp(1.1rem, 1.7vw, 1.5rem)'
                                                : 'clamp(1.2rem, 1.8vw, 1.7rem)',
                                        fontWeight: '900',
                                        lineHeight: '1.2',
                                        fontFamily: 'inherit',
                                        display: 'block',
                                        letterSpacing: isArabicName ? 'normal' : '-0.02em',
                                        transition: 'font-size 0.2s ease',
                                        width: 'fit-content',
                                        whiteSpace: 'pre-wrap' // Handle internal wrapping if name is extremely long
                                    };

                                    if (!part2) {
                                        return (
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%' }}>
                                                <span style={{ ...textStyle, textAlign: 'center', width: '100%' }}>{part1}</span>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: '100%',
                                            direction: isArabicName ? 'rtl' : 'ltr'
                                        }}>
                                            <span style={{
                                                ...textStyle,
                                                textAlign: 'center',
                                                transform: isTwoWords ? (isArabicName ? 'translateX(0.8rem)' : 'translateX(-0.8rem)') : 'none'
                                            }}>{part1}</span>
                                            <span style={{
                                                ...textStyle,
                                                textAlign: 'center',
                                                transform: isTwoWords ? (isArabicName ? 'translateX(-0.8rem)' : 'translateX(0.8rem)') : 'none',
                                                marginTop: '-0.3rem'
                                            }}>
                                                {part2}
                                            </span>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>

                    {/* Mobile Close */}
                    {isMobile && (
                        <button
                            onClick={() => setIsSidebarOpen(false)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-on-accent)', fontSize: '1.5rem', cursor: 'pointer', opacity: 0.7 }}
                        >
                            ×
                        </button>
                    )}
                </div>

                <nav style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    padding: (user?.role === 'SUPER_ADMIN') ? '0.25rem 1rem 1rem' : '0 1rem 1rem', // Reduced top padding
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    scrollbarGutter: 'stable'
                }}>
                    {!isCollapsed && <p style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-faint)', [isRtl ? 'paddingRight' : 'paddingLeft']: '1rem', marginBottom: '0.25rem', letterSpacing: '0.1em' }}>{t('menu')}</p>}

                    {/* Names, icons and hrefs all come from lib/modules.ts, which
                        is also what the Company Settings screen writes overrides
                        against — so a renamed module is renamed here and nowhere
                        else has to be told. */}
                    {MENU_MODULES.map(key => modules.entry(key)).map(link => (
                        <Link
                            key={link.href}
                            href={link.href}
                            // Prefetch re-enabled: this is a small fixed set of
                            // links (not one per row of a list that scales with
                            // data — that's what caused the original fan-out),
                            // and it's the single most-used navigation surface
                            // in the app, so losing prefetch here was the most
                            // felt part of that trade-off.
                            onClick={() => isMobile && setIsSidebarOpen(false)}
                            title={isCollapsed ? link.label : ''}
                            className="nav-link"
                            style={{
                                color: 'var(--sidebar-fg)',
                                textDecoration: 'none',
                                padding: '0.85rem 1rem',
                                borderRadius: '1rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: isCollapsed ? 'center' : 'flex-start',
                                gap: isCollapsed ? '0' : '1rem',
                                transition: 'all 0.2s',
                                fontSize: '0.95rem',
                                fontWeight: '500',
                                border: '1px solid transparent'
                            }}
                            onMouseOver={(e) => {
                                e.currentTarget.style.background = 'var(--veil-10)'
                                e.currentTarget.style.color = 'var(--sidebar-fg-strong)'
                                e.currentTarget.style.transform = isCollapsed ? 'scale(1.1)' : 'translateX(5px)'
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.background = 'transparent'
                                e.currentTarget.style.color = 'var(--sidebar-fg)'
                                e.currentTarget.style.transform = 'none'
                            }}
                        >
                            <span style={{ fontSize: '1.4rem', opacity: isLockedHref(link.href) ? 0.45 : 1 }}>{link.icon}</span>
                            {!isCollapsed && (
                                <span style={{ opacity: isLockedHref(link.href) ? 0.55 : 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    {link.label}
                                    {isLockedHref(link.href) && <span style={{ fontSize: '0.75rem' }} title={t('module_locked_title' as any)}>🔒</span>}
                                </span>
                            )}
                        </Link>
                    ))}

                    {/* G5: the payslip document was reachable only by typing
                        its URL. This is the way in for the person it is about —
                        everyone, not just managers, which is why it sits in the
                        main menu rather than beside Payroll below. Locked with
                        the rest of the PAYROLL module; the page itself explains
                        the case where a company has payslips switched off. */}
                    <Link
                        href="/dashboard/documents"
                        onClick={() => isMobile && setIsSidebarOpen(false)}
                        title={isCollapsed ? t('my_payslips') : ''}
                        className="nav-link"
                        style={{
                            color: 'var(--sidebar-fg)',
                            textDecoration: 'none',
                            padding: '0.85rem 1rem',
                            borderRadius: '1rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: isCollapsed ? 'center' : 'flex-start',
                            gap: isCollapsed ? '0' : '1rem',
                            transition: 'all 0.2s',
                            fontSize: '0.95rem',
                            fontWeight: '500',
                            border: '1px solid transparent'
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.background = 'var(--veil-10)'
                            e.currentTarget.style.color = 'var(--sidebar-fg-strong)'
                            e.currentTarget.style.transform = isCollapsed ? 'scale(1.1)' : 'translateX(5px)'
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.background = 'transparent'
                            e.currentTarget.style.color = 'var(--sidebar-fg)'
                            e.currentTarget.style.transform = 'none'
                        }}
                    >
                        <span style={{ fontSize: '1.4rem', opacity: isLockedHref('/dashboard/documents') ? 0.45 : 1 }}>📄</span>
                        {!isCollapsed && (
                            <span style={{ opacity: isLockedHref('/dashboard/documents') ? 0.55 : 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                {t('my_payslips')}
                                {isLockedHref('/dashboard/documents') && <span style={{ fontSize: '0.75rem' }} title={t('module_locked_title' as any)}>🔒</span>}
                            </span>
                        )}
                    </Link>

                    {(managementLinks.length > 0 || canSeePayroll || canSeeRoleRequests) && (
                        <>
                            {isCollapsed ? (
                                <hr style={{ border: 'none', borderTop: '1px solid var(--veil-30)', margin: '1rem auto', width: '50%' }} />
                            ) : (
                                <p style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-faint)', [isRtl ? 'paddingRight' : 'paddingLeft']: '1rem', marginTop: '1.5rem', marginBottom: '0.25rem', letterSpacing: '0.1em' }}>{t('management')}</p>
                            )}

                            {/* Vendors is in here: its custom name used to be the
                                only one of these that existed, through its own
                                column. It is now just another module with an
                                override, and the other eight can be renamed too.
                                A Super Admin, who belongs to no one company, sees
                                the defaults — see lib/auth.ts. */}
                            {managementLinks.map(link => (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    onClick={() => isMobile && setIsSidebarOpen(false)}
                                    title={isCollapsed ? link.label : ''}
                                    className="nav-link"
                                    style={{
                                        color: 'var(--sidebar-fg)',
                                        textDecoration: 'none',
                                        padding: '0.85rem 1rem',
                                        borderRadius: '1rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: isCollapsed ? 'center' : 'flex-start',
                                        gap: isCollapsed ? '0' : '1.25rem',
                                        transition: 'all 0.2s',
                                        fontSize: '0.95rem',
                                        fontWeight: '500'
                                    }}
                                    onMouseOver={(e) => {
                                        e.currentTarget.style.background = 'var(--veil-10)'
                                        e.currentTarget.style.color = 'var(--sidebar-fg-strong)'
                                        e.currentTarget.style.transform = isCollapsed ? 'scale(1.1)' : 'translateX(5px)'
                                    }}
                                    onMouseOut={(e) => {
                                        e.currentTarget.style.background = 'transparent'
                                        e.currentTarget.style.color = 'var(--sidebar-fg)'
                                        e.currentTarget.style.transform = 'none'
                                    }}
                                >
                                    <span style={{ fontSize: '1.4rem', opacity: isLockedHref(link.href) ? 0.45 : 1 }}>{link.icon}</span>
                                    {!isCollapsed && (
                                        <span style={{ opacity: isLockedHref(link.href) ? 0.55 : 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            {link.label}
                                            {isLockedHref(link.href) && <span style={{ fontSize: '0.75rem' }} title={t('module_locked_title' as any)}>🔒</span>}
                                        </span>
                                    )}
                                </Link>
                            ))}
                            {/* Payroll sits beside the management modules but
                                is not one of them: lib/modules.ts is the list a
                                company can rename and reorder, and payroll is
                                not theirs to rename. It is still gated, by the
                                same PAYROLL module that already gates salary
                                history — hand-written here only because its
                                entry is. Offered with payroll.view: a Team
                                Leader manages people, not pay. */}
                            {canSeePayroll && (
                                <Link
                                    href="/dashboard/payroll"
                                    onClick={() => isMobile && setIsSidebarOpen(false)}
                                    title={isCollapsed ? t('payroll') : ''}
                                    className="nav-link"
                                    style={{
                                        color: 'var(--sidebar-fg)',
                                        textDecoration: 'none',
                                        padding: '0.85rem 1rem',
                                        borderRadius: '1rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: isCollapsed ? 'center' : 'flex-start',
                                        gap: isCollapsed ? '0' : '1rem',
                                        transition: 'all 0.2s',
                                        fontSize: '0.95rem',
                                        fontWeight: '500'
                                    }}
                                    onMouseOver={(e) => {
                                        e.currentTarget.style.background = 'var(--veil-10)'
                                        e.currentTarget.style.color = 'var(--sidebar-fg-strong)'
                                        e.currentTarget.style.transform = isCollapsed ? 'scale(1.1)' : 'translateX(5px)'
                                    }}
                                    onMouseOut={(e) => {
                                        e.currentTarget.style.background = 'transparent'
                                        e.currentTarget.style.color = 'var(--sidebar-fg)'
                                        e.currentTarget.style.transform = 'none'
                                    }}
                                >
                                    <span style={{ fontSize: '1.4rem' }}>🧾</span>
                                    {!isCollapsed && <span style={{ flex: 1 }}>{t('payroll')}</span>}
                                    {!isCollapsed && isLockedHref('/dashboard/payroll') && (
                                        <span style={{ fontSize: '0.75rem' }} title={t('module_locked_title' as any)}>🔒</span>
                                    )}
                                </Link>
                            )}
                            {canSeeRoleRequests && (
                                <Link
                                    href="/dashboard/role-requests"
                                    onClick={() => isMobile && setIsSidebarOpen(false)}
                                    title={isCollapsed ? t('role_requests_title') : ''}
                                    className="nav-link"
                                    style={{
                                        color: 'var(--sidebar-fg)',
                                        textDecoration: 'none',
                                        padding: '0.85rem 1rem',
                                        borderRadius: '1rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: isCollapsed ? 'center' : 'flex-start',
                                        gap: isCollapsed ? '0' : '1rem',
                                        transition: 'all 0.2s',
                                        fontSize: '0.95rem',
                                        fontWeight: '500'
                                    }}
                                    onMouseOver={(e) => {
                                        e.currentTarget.style.background = 'var(--veil-10)'
                                        e.currentTarget.style.color = 'var(--sidebar-fg-strong)'
                                        e.currentTarget.style.transform = isCollapsed ? 'scale(1.1)' : 'translateX(5px)'
                                    }}
                                    onMouseOut={(e) => {
                                        e.currentTarget.style.background = 'transparent'
                                        e.currentTarget.style.color = 'var(--sidebar-fg)'
                                        e.currentTarget.style.transform = 'none'
                                    }}
                                >
                                    <span style={{ fontSize: '1.4rem' }}>🪪</span>
                                    {!isCollapsed && <span style={{ flex: 1 }}>{t('role_requests_title')}</span>}
                                </Link>
                            )}
                        </>
                    )}

                    {/* SUPER ADMIN ONLY */}
                    {user?.role === 'SUPER_ADMIN' && (
                        <>
                            {isCollapsed ? (
                                <hr style={{ border: 'none', borderTop: '1px solid var(--veil-30)', margin: '1rem auto', width: '50%' }} />
                            ) : (
                                <p style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-faint)', [isRtl ? 'paddingRight' : 'paddingLeft']: '1rem', marginTop: '1.5rem', marginBottom: '0.25rem', letterSpacing: '0.1em' }}>{t('system')}</p>
                            )}

                            {[
                                { href: '/dashboard/super-admins', label: t('super_admins'), icon: '🛡️' },
                                { href: '/dashboard/companies', label: t('companies'), icon: '🏢' },
                                { href: '/dashboard/packages', label: t('packages'), icon: '📦' },
                                { href: '/dashboard/role-templates', label: t('role_templates_title'), icon: '🧩' },
                                { href: '/dashboard/who-can', label: t('who_can_title'), icon: '🔎' },
                                { href: '/dashboard/role-change-requests', label: t('role_changes_title'), icon: '📨' },
                                { href: '/dashboard/access-reviews', label: t('access_review_title'), icon: '🗂️' },
                                { href: '/dashboard/all-users', label: t('all_users'), icon: '👥' },
                                { href: '/dashboard/audit-logs', label: t('audit_logs'), icon: '📜' },
                                { href: '/dashboard/health', label: t('system_health') || 'System Health', icon: '❤️' },
                                { href: '/dashboard/system-settings', label: t('system_settings') || 'System Settings', icon: '⚙️' }
                            ].map(link => (
                                <Link key={link.href} href={link.href} onClick={() => isMobile && setIsSidebarOpen(false)} title={isCollapsed ? link.label : ''} className="nav-link" style={{
                                    color: 'var(--sidebar-fg)',
                                    textDecoration: 'none',
                                    padding: '0.85rem 1rem',
                                    borderRadius: '1rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: isCollapsed ? 'center' : 'flex-start',
                                    gap: isCollapsed ? '0' : '1rem',
                                    transition: 'all 0.2s',
                                    fontSize: '0.95rem',
                                    fontWeight: '500'
                                }}
                                    onMouseOver={(e) => {
                                        e.currentTarget.style.background = 'var(--veil-10)'
                                        e.currentTarget.style.color = 'var(--sidebar-fg-strong)'
                                        e.currentTarget.style.transform = isCollapsed ? 'scale(1.1)' : 'translateX(5px)'
                                    }}
                                    onMouseOut={(e) => {
                                        e.currentTarget.style.background = 'transparent'
                                        e.currentTarget.style.color = 'var(--sidebar-fg)'
                                        e.currentTarget.style.transform = 'none'
                                    }}
                                >
                                    <span style={{ fontSize: '1.4rem', opacity: isLockedHref(link.href) ? 0.45 : 1 }}>{link.icon}</span>
                                    {!isCollapsed && (
                                        <span style={{ opacity: isLockedHref(link.href) ? 0.55 : 1, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            {link.label}
                                            {isLockedHref(link.href) && <span style={{ fontSize: '0.75rem' }} title={t('module_locked_title' as any)}>🔒</span>}
                                        </span>
                                    )}
                                </Link>
                            ))}
                        </>
                    )}
                </nav>

                {/* Sidebar Bottom — the legal documents live here because the
                    app has no footer, and a policy reachable only from Google's
                    consent screen is a link in a console rather than something
                    a user can find. marginTop:auto keeps them pinned under the
                    nav whatever its length, which is what the old spacer did.
                    Hidden when collapsed: the rail is icon-width there, and a
                    truncated "Priv…" is worse than nothing. */}
                <div style={{ marginTop: 'auto', padding: '1rem' }}>
                    {!isCollapsed && (
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.35rem',
                            fontSize: '0.7rem',
                        }}>
                            <a
                                href="/privacy"
                                style={{ color: 'var(--sidebar-fg)', textDecoration: 'none', opacity: 0.7 }}
                                onMouseEnter={e => { e.currentTarget.style.color = 'var(--sidebar-fg-strong)'; e.currentTarget.style.opacity = '1' }}
                                onMouseLeave={e => { e.currentTarget.style.color = 'var(--sidebar-fg)'; e.currentTarget.style.opacity = '0.7' }}
                            >
                                {t('privacy_policy' as any)}
                            </a>
                            <a
                                href="/terms"
                                style={{ color: 'var(--sidebar-fg)', textDecoration: 'none', opacity: 0.7 }}
                                onMouseEnter={e => { e.currentTarget.style.color = 'var(--sidebar-fg-strong)'; e.currentTarget.style.opacity = '1' }}
                                onMouseLeave={e => { e.currentTarget.style.color = 'var(--sidebar-fg)'; e.currentTarget.style.opacity = '0.7' }}
                            >
                                {t('terms_of_service' as any)}
                            </a>
                        </div>
                    )}
                </div>
            </aside>

            {/* Main Content Wrapper */}
            <main style={{
                flex: 1,
                // A flex item is never narrower than its content by default,
                // and a header subtitle that cuts off with an ellipsis still
                // counts at full length: a long one widened the whole page.
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                [isRtl ? 'marginRight' : 'marginLeft']: (!isMobile) ? sidebarWidth : '0', // Dynamic margin based on collapse state
                minHeight: '100vh',
                background: 'transparent',
                transition: 'margin 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                direction: isRtl ? 'rtl' : 'ltr',
            }}>
                {/* Floating Glass Header */}
                <div style={{
                    // Tokenised: this was a hardcoded white glass, so on a dark
                    // ground it became a pale bar with the page heading behind
                    // it showing straight through. Saturation on top of the blur
                    // is what makes it read as glass rather than as a veil.
                    background: isScrolled ? 'var(--header-glass-bg)' : 'transparent',
                    backdropFilter: isScrolled ? 'blur(20px) saturate(160%)' : 'none',
                    WebkitBackdropFilter: isScrolled ? 'blur(20px) saturate(160%)' : 'none',
                    borderBottom: isScrolled ? '1px solid var(--header-glass-border)' : '1px solid transparent',
                    position: 'sticky',
                    top: 0,
                    zIndex: 40,
                    boxShadow: isScrolled ? 'var(--header-shadow)' : 'none',
                    transition: 'all 0.3s ease',
                    margin: isScrolled ? '1rem' : '0',
                    borderRadius: isScrolled ? '1.5rem' : '0',
                    marginTop: isScrolled ? '1rem' : '0',
                }}>
                    <DashboardHeader
                        user={user}
                        onMenuClick={() => setIsSidebarOpen(true)}
                    />
                </div>

                <div style={{ padding: '2rem', maxWidth: '1600px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
                    {/* Above the page rather than inside it, so it appears on
                        every screen without thirty pages having to remember. It
                        renders nothing at all when the subscription is simply
                        working — there is no dismiss control because grace is
                        not something a customer should be able to dismiss. */}
                    <PreviewBanner preview={user?.preview} />
                    <SubscriptionBanner />
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
                    ...(isMobile
                        ? {
                            position: 'static' as const,
                            width: '100%',
                            padding: '2rem 1rem 2.5rem',
                            marginTop: 'auto',
                        }
                        : {
                            position: 'fixed' as const,
                            bottom: '1rem',
                            [isRtl ? 'left' : 'right']: '1.5rem',
                            // Below the scrim and the sidebar, so it can never
                            // paint over navigation or a dialog again. It was
                            // 100, which is above both.
                            zIndex: 30,
                        }),
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center', // Centered relative to each other
                    pointerEvents: 'none',
                    opacity: 0.7,
                    transition: 'all 0.3s ease',
                    textAlign: 'center'
                }} className="floating-attribution">
                    <span style={{
                        fontSize: '0.45rem',
                        color: 'var(--text-soft)',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        fontFamily: "'Inter', sans-serif"
                    }}>
                        {t('powered_by') || 'Powered by'}
                    </span>
                    <span style={{
                        fontSize: '1.35rem',
                        color: 'var(--text-main)',
                        fontWeight: '900',
                        letterSpacing: '0.15em',
                        marginTop: '0.05rem',
                        textTransform: 'uppercase',
                        fontFamily: "'Inter', sans-serif",
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
