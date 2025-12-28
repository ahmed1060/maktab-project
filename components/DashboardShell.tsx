'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import DashboardHeader from './DashboardHeader'
import { useLanguage } from '@/context/LanguageContext'

interface DashboardShellProps {
    children: React.ReactNode
    user: any // Typed from session
}

export default function DashboardShell({ children, user }: DashboardShellProps) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false)
    const [isMobile, setIsMobile] = useState(false)
    const [isCollapsed, setIsCollapsed] = useState(false) // New State for Desktop Collapse
    const { t, locale } = useLanguage()
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
        ? (selectedCompanyName || 'Task Manager')
        : (user?.companyName || 'Task Manager')

    return (
        <div style={{ display: 'flex', minHeight: '100vh', background: 'transparent' }}>
            {/* Sidebar Overlay for Mobile */}
            {isMobile && isSidebarOpen && (
                <div
                    onClick={() => setIsSidebarOpen(false)}
                    style={{
                        position: 'fixed', inset: 0,
                        backgroundColor: 'rgba(0,0,0,0.3)',
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
                transform: (isMobile && !isSidebarOpen) ? (isRtl ? 'translateX(100%)' : 'translateX(0)') : 'translateX(0)',
                boxShadow: (isMobile && isSidebarOpen) ? (isRtl ? '-20px 0 50px rgba(0,0,0,0.2)' : '20px 0 50px rgba(0,0,0,0.2)') : 'none',
                overflow: 'hidden',
                direction: isRtl ? 'rtl' : 'ltr'
            }}>
                <div style={{
                    height: (user?.role === 'SUPER_ADMIN') ? '70px' : '55px', // Reduced by 10-15px
                    paddingInlineStart: isCollapsed ? '1rem' : '2rem',
                    paddingInlineEnd: '10px',
                    paddingTop: (user?.role === 'SUPER_ADMIN' ? '0.25rem' : 0), // Tightened
                    display: 'flex',
                    justifyContent: isCollapsed ? 'center' : 'flex-start',
                    alignItems: 'center',
                    transition: 'all 0.4s ease',
                    width: '100%',
                    boxSizing: 'border-box'
                }}>
                    <div
                        onClick={() => !isMobile && setIsCollapsed(!isCollapsed)}
                        style={{
                            fontSize: '1.5rem',
                            fontWeight: '800',
                            letterSpacing: '-0.025em',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            color: 'white',
                            whiteSpace: 'nowrap',
                            overflow: 'visible',
                            cursor: !isMobile ? 'pointer' : 'default',
                            flex: 1,
                            minWidth: 0, // Allow shrinking to prevent overflow
                            width: 'auto'
                        }}
                        title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                    >
                        <span style={{ fontSize: isCollapsed ? '2rem' : '1.75rem', transition: 'font-size 0.3s', flexShrink: 0 }}>🚀</span>
                        {!isCollapsed && (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-start',
                                flex: 1,
                                position: 'relative',
                                border: 'none', // Removed testing border
                                padding: '0.4rem 0.6rem 0.5rem 0.6rem', // Trimmed bottom padding slightly
                                boxSizing: 'border-box',
                                width: 'fit-content',
                                maxWidth: '100%',
                                overflow: 'visible'
                            }}>
                                {(() => {
                                    const words = displayName.split(' ');
                                    const part1 = words[0] || '';
                                    const part2 = words.slice(1).join(' ');

                                    const nameLength = displayName.length;
                                    const textStyle: React.CSSProperties = {
                                        background: 'linear-gradient(to right, #ffffff, #a5b4fc)',
                                        WebkitBackgroundClip: 'text',
                                        WebkitTextFillColor: 'transparent',
                                        // Dynamic font size: shrinks as name gets longer to "flex" within the sidebar
                                        fontSize: nameLength > 20
                                            ? 'clamp(0.9rem, 1.4vw, 1.2rem)'
                                            : nameLength > 12
                                                ? 'clamp(1.1rem, 1.7vw, 1.5rem)'
                                                : 'clamp(1.2rem, 1.8vw, 1.7rem)',
                                        fontWeight: '900',
                                        lineHeight: '1.1', // Increased from 0.9 to fix descender clipping
                                        whiteSpace: 'nowrap',
                                        fontFamily: 'inherit',
                                        display: 'block',
                                        letterSpacing: '-0.02em',
                                        transition: 'font-size 0.2s ease'
                                    };

                                    const isArabic = /[\u0600-\u06FF]/.test(displayName);
                                    const textDirection = isArabic ? 'rtl' : 'ltr';

                                    if (!part2) {
                                        return (
                                            <span dir={textDirection} style={{
                                                ...textStyle,
                                                fontSize: 'clamp(1.2rem, 1.8vw, 2rem)',
                                                textAlign: 'center'
                                            }}>
                                                {part1}
                                            </span>
                                        );
                                    }

                                    return (
                                        <div
                                            dir={textDirection}
                                            style={{
                                                display: 'flex',
                                                flexDirection: 'column',
                                                width: '100%',
                                                alignItems: 'center', // Center group as a whole
                                                justifyContent: 'center'
                                            }}
                                        >
                                            <div style={{ width: 'fit-content', position: 'relative' }}>
                                                {/* Top Word */}
                                                <span style={textStyle}>{part1}</span>

                                                {/* Bottom Word: Staggered logically. 
                                                    In LTR, pushes Right. In RTL, pushes Left. */}
                                                <span style={{
                                                    ...textStyle,
                                                    marginInlineStart: `calc(${part1.length - 1}ch * 0.72)`,
                                                    marginTop: '-0.3rem'
                                                }}>
                                                    {part2}
                                                </span>
                                            </div>
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
                            style={{ background: 'none', border: 'none', color: 'white', fontSize: '1.5rem', cursor: 'pointer', opacity: 0.7 }}
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
                    {!isCollapsed && <p style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', color: '#94a3b8', [isRtl ? 'paddingRight' : 'paddingLeft']: '1rem', marginBottom: '0.25rem', letterSpacing: '0.1em' }}>{t('menu' as any)}</p>}

                    {[
                        { href: '/dashboard', label: t('dashboard'), icon: '📊' },
                        { href: '/dashboard/tasks', label: t('tasks'), icon: '✅' },
                        { href: '/dashboard/obligations', label: t('obligations'), icon: '📌' },
                        { href: '/dashboard/day-off-requests', label: t('day_off_requests'), icon: '📅' },
                        { href: '/dashboard/clients', label: t('clients'), icon: '🤝' },
                    ].map(link => (
                        <Link
                            key={link.href}
                            href={link.href}
                            onClick={() => isMobile && setIsSidebarOpen(false)}
                            title={isCollapsed ? link.label : ''}
                            className="nav-link"
                            style={{
                                color: 'rgba(255,255,255,0.8)',
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
                                e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                                e.currentTarget.style.color = 'white'
                                e.currentTarget.style.transform = isCollapsed ? 'scale(1.1)' : 'translateX(5px)'
                            }}
                            onMouseOut={(e) => {
                                e.currentTarget.style.background = 'transparent'
                                e.currentTarget.style.color = 'rgba(255,255,255,0.8)'
                                e.currentTarget.style.transform = 'none'
                            }}
                        >
                            <span style={{ fontSize: '1.4rem' }}>{link.icon}</span>
                            {!isCollapsed && <span>{link.label}</span>}
                        </Link>
                    ))}

                    {(['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(user?.role || '')) && (
                        <>
                            {isCollapsed ? (
                                <hr style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.3)', margin: '1rem auto', width: '50%' }} />
                            ) : (
                                <p style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', color: '#94a3b8', [isRtl ? 'paddingRight' : 'paddingLeft']: '1rem', marginTop: '1.5rem', marginBottom: '0.25rem', letterSpacing: '0.1em' }}>{t('management' as any)}</p>
                            )}

                            {[
                                { href: '/dashboard/costs', label: t('costs'), icon: '💰' },
                                { href: '/dashboard/employees', label: t('employees'), icon: '👥' },
                            ].map(link => (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    onClick={() => isMobile && setIsSidebarOpen(false)}
                                    title={isCollapsed ? link.label : ''}
                                    className="nav-link"
                                    style={{
                                        color: 'rgba(255,255,255,0.8)',
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
                                        e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                                        e.currentTarget.style.color = 'white'
                                        e.currentTarget.style.transform = isCollapsed ? 'scale(1.1)' : 'translateX(5px)'
                                    }}
                                    onMouseOut={(e) => {
                                        e.currentTarget.style.background = 'transparent'
                                        e.currentTarget.style.color = 'rgba(255,255,255,0.8)'
                                        e.currentTarget.style.transform = 'none'
                                    }}
                                >
                                    <span style={{ fontSize: '1.4rem' }}>{link.icon}</span>
                                    {!isCollapsed && <span>{link.label}</span>}
                                </Link>
                            ))}
                        </>
                    )}

                    {/* SUPER ADMIN ONLY */}
                    {user?.role === 'SUPER_ADMIN' && (
                        <>
                            {isCollapsed ? (
                                <hr style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.3)', margin: '1rem auto', width: '50%' }} />
                            ) : (
                                <p style={{ fontSize: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', color: '#94a3b8', [isRtl ? 'paddingRight' : 'paddingLeft']: '1rem', marginTop: '1.5rem', marginBottom: '0.25rem', letterSpacing: '0.1em' }}>{t('system')}</p>
                            )}

                            {[
                                { href: '/dashboard/super-admins', label: t('super_admins'), icon: '🛡️' },
                                { href: '/dashboard/companies', label: t('companies'), icon: '🏢' },
                                { href: '/dashboard/all-users', label: t('all_users'), icon: '👥' }
                            ].map(link => (
                                <Link key={link.href} href={link.href} onClick={() => isMobile && setIsSidebarOpen(false)} title={isCollapsed ? link.label : ''} className="nav-link" style={{
                                    color: 'rgba(255,255,255,0.8)',
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
                                        e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                                        e.currentTarget.style.color = 'white'
                                        e.currentTarget.style.transform = isCollapsed ? 'scale(1.1)' : 'translateX(5px)'
                                    }}
                                    onMouseOut={(e) => {
                                        e.currentTarget.style.background = 'transparent'
                                        e.currentTarget.style.color = 'rgba(255,255,255,0.8)'
                                        e.currentTarget.style.transform = 'none'
                                    }}
                                >
                                    <span style={{ fontSize: '1.4rem' }}>{link.icon}</span>
                                    {!isCollapsed && <span>{link.label}</span>}
                                </Link>
                            ))}
                        </>
                    )}
                </nav>

                {!isCollapsed && (
                    <div style={{ marginTop: 'auto', padding: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)' }}>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                            &copy; 2025 Maktab Project
                        </div>
                    </div>
                )}
            </aside>

            {/* Main Content Wrapper */}
            <main style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                [isRtl ? 'marginRight' : 'marginLeft']: (!isMobile) ? sidebarWidth : '0', // Dynamic margin based on collapse state
                minHeight: '100vh',
                background: 'transparent',
                width: '100%',
                transition: 'margin 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                direction: isRtl ? 'rtl' : 'ltr'
            }}>
                {/* Floating Glass Header */}
                <div style={{
                    background: isScrolled ? 'rgba(255, 255, 255, 0.65)' : 'transparent',
                    backdropFilter: isScrolled ? 'blur(16px)' : 'none',
                    borderBottom: isScrolled ? '1px solid rgba(255,255,255,0.3)' : '1px solid transparent',
                    position: 'sticky',
                    top: 0,
                    zIndex: 40,
                    boxShadow: isScrolled ? '0 4px 30px rgba(0,0,0,0.05)' : 'none',
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

                <div style={{ padding: '2rem', maxWidth: '1400px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
                    {children}
                </div>
            </main>
        </div>
    )
}
