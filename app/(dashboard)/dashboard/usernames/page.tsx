'use client'

import { useState, useEffect } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import { useHeader } from '@/context/HeaderContext'
import { useToast } from '@/context/ToastContext'
// F-20: xlsx (SheetJS) is on a version with an unfixable-from-npm CVE
// (prototype pollution + ReDoS in the parser) — SheetJS stopped publishing
// patched releases to npm. exceljs is maintained and gets normal npm
// updates, but is a noticeably heavier bundle — imported dynamically below
// so it only loads when the export button is actually clicked, not on
// every visit to this page.

type User = {
    id: string
    firstName: string
    lastName: string
    role: string
    username?: string | null
    email: string
    company?: {
        name: string
    }
}

export default function UsernamesPage() {
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const { showToast } = useToast()
    const [users, setUsers] = useState<User[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                // Fetch all active users the current user can see
                const res = await fetch('/api/users?limit=1000')
                if (res.ok) {
                    const result = await res.json()
                    const data = result.data.data || result.data || []
                    setUsers(data)
                } else {
                    showToast(t('failed_fetch_data'), 'error')
                }
            } catch (err) {
                console.error('Failed to fetch users', err)
                showToast(t('failed_fetch_data'), 'error')
            } finally {
                setLoading(false)
            }
        }
        fetchUsers()
        // Deliberately run once on mount only — t/showToast are recreated
        // every render, and this is a one-time initial load, not something
        // that should refetch on every locale toggle or re-render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        setTitle(t('usernames'))
        setSubtitle(t('usernames_subtitle'))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t])

    const downloadExcel = async () => {
        const { Workbook } = await import('exceljs')

        const now = new Date()
        const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`
        const isAr = locale === 'ar'

        const workbook = new Workbook()
        const sheetBaseName = isAr ? "المستخدمين" : "Users"
        const sheetName = `${sheetBaseName}_${timeStr}`
        // RTL support for Arabic (equivalent of the old worksheet['!views'] / workbook.Workbook.Views RTL flags)
        const worksheet = workbook.addWorksheet(sheetName, isAr ? { views: [{ rightToLeft: true }] } : undefined)

        worksheet.columns = [
            { header: isAr ? 'الاسم' : 'Name', key: 'name', width: 30 },
            { header: isAr ? 'الدور' : 'Role', key: 'role', width: 20 },
            { header: isAr ? 'اسم المستخدم' : 'Username', key: 'username', width: 25 },
        ]

        users.forEach(u => {
            worksheet.addRow({
                name: `${u.firstName} ${u.lastName}`,
                role: u.role ? (t(`role_${u.role.toLowerCase()}` as any) || u.role) : '-',
                username: u.username || '-'
            })
        })

        const filename = isAr
            ? `أسماء المستخدمين_${new Date().toISOString().split('T')[0]}.xlsx`
            : `Employees Usernames_${new Date().toISOString().split('T')[0]}.xlsx`

        // exceljs has no writeFile helper for the browser (that's Node-only,
        // via fs) — build the file in memory and trigger the download manually.
        const buffer = await workbook.xlsx.writeBuffer()
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
    }

    return (
        <div style={{ padding: '2rem', direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '2rem' }}>
                <button
                    onClick={downloadExcel}
                    className="btn"
                    title={t('download_excel')}
                    style={{
                        background: 'var(--ok-solid)',
                        color: 'var(--text-on-accent)',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                        padding: '0.6rem 1rem',
                        borderRadius: '0.75rem',
                        border: 'none',
                        boxShadow: '0 4px 6px -1px var(--shadow-weak)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 12px -2px var(--shadow-weak)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 6px -1px var(--shadow-weak)'; }}
                >
                    <span style={{ fontSize: '1.2rem' }}>📊</span>
                    <span style={{ fontSize: '1.2rem' }}>📥</span>
                </button>
            </div>

            {loading ? <LoadingSpinner message={t('loading_users')} /> : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: '1rem'
                }}>
                    {users.map(user => (
                        <div
                            key={user.id}
                            style={{
                                background: 'var(--surface)',
                                padding: '1rem',
                                borderRadius: '1rem',
                                border: '1px solid var(--border)',
                                boxShadow: '0 1px 3px var(--shadow-faint)',
                                transition: 'transform 0.2s, box-shadow 0.2s'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontSize: '1.1rem',
                                        fontWeight: 'bold',
                                        color: 'var(--text-strong)',
                                        marginBottom: '0.1rem',
                                        lineHeight: '1.2'
                                    }}>
                                        {user.firstName} {user.lastName}
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)', fontWeight: '500', textTransform: 'capitalize' }}>
                                        {t(`role_${(user as any).role?.toLowerCase()}` as any) || (user as any).role || '-'}
                                    </div>
                                </div>
                                <div style={{
                                    background: 'var(--info-bg-subtle)',
                                    padding: '0.25rem 0.5rem',
                                    borderRadius: '0.5rem',
                                    border: '1px solid var(--info-bg-indigo)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0
                                }}>
                                    <code style={{
                                        fontSize: '0.85rem',
                                        color: 'var(--info-solid-hover)',
                                        fontWeight: '800',
                                        letterSpacing: '0.5px'
                                    }}>
                                        {user.username || '-'}
                                    </code>
                                </div>
                            </div>
                        </div>
                    ))}
                    {users.length === 0 && (
                        <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '3rem', color: 'var(--text-soft)' }}>
                            {t('no_employees_found')}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
