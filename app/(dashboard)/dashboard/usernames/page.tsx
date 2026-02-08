'use client'

import { useState, useEffect } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import * as XLSX from 'xlsx'

type User = {
    id: string
    firstName: string
    lastName: string
    username?: string | null
    email: string
    company?: {
        name: string
    }
}

export default function UsernamesPage() {
    const { t, locale } = useLanguage()
    const [users, setUsers] = useState<User[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const fetchUsers = async () => {
            try {
                // Fetch all active users the current user can see
                const res = await fetch('/api/users?limit=1000')
                if (res.ok) {
                    const responseData = await res.json()
                    const data = Array.isArray(responseData) ? responseData : (responseData.data || [])
                    setUsers(data)
                }
            } catch (err) {
                console.error('Failed to fetch users', err)
            } finally {
                setLoading(false)
            }
        }
        fetchUsers()
    }, [])

    const downloadExcel = () => {
        const data = users.map(u => ({
            [locale === 'ar' ? 'الاسم' : 'Name']: `${u.firstName} ${u.lastName}`,
            [locale === 'ar' ? 'اسم المستخدم' : 'Username']: u.username || '-',
            [locale === 'ar' ? 'الدور' : 'Role']: t(`role_${(u as any).role?.toLowerCase()}` as any) || (u as any).role || '-'
        }))

        const worksheet = XLSX.utils.json_to_sheet(data)
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, "Users")

        const wscols = [{ wch: 30 }, { wch: 20 }, { wch: 25 }]
        worksheet['!cols'] = wscols

        XLSX.writeFile(workbook, `Employees_Usernames_${new Date().toISOString().split('T')[0]}.xlsx`)
    }

    return (
        <div style={{ padding: '2rem', direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '2rem' }}>
                <button
                    onClick={downloadExcel}
                    className="btn"
                    title={t('download_excel')}
                    style={{
                        background: '#10b981',
                        color: 'white',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                        padding: '0.6rem 1rem',
                        borderRadius: '0.75rem',
                        border: 'none',
                        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease'
                    }}
                    onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 12px -2px rgba(0,0,0,0.15)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)'; }}
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
                                background: 'white',
                                padding: '1rem',
                                borderRadius: '1rem',
                                border: '1px solid #e2e8f0',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                                transition: 'transform 0.2s, box-shadow 0.2s'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontSize: '1.1rem',
                                        fontWeight: 'bold',
                                        color: '#0f172a',
                                        marginBottom: '0.1rem',
                                        lineHeight: '1.2'
                                    }}>
                                        {user.firstName} {user.lastName}
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: '500', textTransform: 'capitalize' }}>
                                        {t(`role_${(user as any).role?.toLowerCase()}` as any) || (user as any).role || '-'}
                                    </div>
                                </div>
                                <div style={{
                                    background: '#eff6ff',
                                    padding: '0.25rem 0.5rem',
                                    borderRadius: '0.5rem',
                                    border: '1px solid #dbeafe',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0
                                }}>
                                    <code style={{
                                        fontSize: '0.85rem',
                                        color: '#2563eb',
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
                        <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                            {t('no_employees_found')}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
