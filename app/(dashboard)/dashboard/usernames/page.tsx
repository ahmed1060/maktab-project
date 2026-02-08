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
            [locale === 'ar' ? 'الشركة' : 'Company']: u.company?.name || '-'
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <button
                        onClick={() => window.history.back()}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#3b82f6',
                            cursor: 'pointer',
                            marginBottom: '1rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            fontSize: '0.9rem'
                        }}
                    >
                        <span>{locale === 'ar' ? '←' : '←'}</span>
                        {t('back' as any) || 'Back'}
                    </button>
                    <h1 style={{ fontSize: '2rem', fontWeight: 'bold' }}>{t('usernames_list')}</h1>
                </div>
                <button
                    onClick={downloadExcel}
                    className="btn"
                    style={{
                        background: '#10b981',
                        color: 'white',
                        fontWeight: '600',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.75rem 1.5rem',
                        borderRadius: '0.75rem',
                        border: 'none',
                        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
                    }}
                >
                    <span>📊</span>
                    {t('download_excel')}
                </button>
            </div>

            {loading ? <LoadingSpinner message={t('loading_users')} /> : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '1.5rem'
                }}>
                    {users.map(user => (
                        <div
                            key={user.id}
                            style={{
                                background: 'white',
                                padding: '1.5rem',
                                borderRadius: '1rem',
                                border: '1px solid #e2e8f0',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                                transition: 'transform 0.2s, box-shadow 0.2s'
                            }}
                        >
                            <div style={{ marginBottom: '1rem' }}>
                                <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: '#0f172a' }}>
                                    {user.firstName} {user.lastName}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                                    {user.company?.name || '-'}
                                </div>
                            </div>
                            <div style={{
                                background: '#f8fafc',
                                padding: '0.75rem',
                                borderRadius: '0.5rem',
                                border: '1px solid #e2e8f0',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                            }}>
                                <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase' }}>
                                    {t('username_label' as any) || 'Username'}
                                </span>
                                <code style={{
                                    fontSize: '1rem',
                                    color: '#2563eb',
                                    fontWeight: 'bold',
                                    letterSpacing: '0.5px'
                                }}>
                                    {user.username || '-'}
                                </code>
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
