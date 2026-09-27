'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import LoadingSpinner from '@/components/LoadingSpinner'
import SegmentedToggle from '@/components/SegmentedToggle'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import { fetcher } from '@/lib/swr-fetcher'
import type { Permission, Scope } from '@/lib/permissions/catalogue'
import { PERMISSION_GROUPS, permissionLabelKey, groupLabelKey, scopeLabelKey } from '@/lib/permissions/matrix'

/**
 * "Who can do this?" (ROLES_PLAN.md §6.5), for the Super Admin. A company and
 * a permission → everyone holding it, at which scope, through which role. A
 * person → everything they may do and through which role. What it shows is
 * read from the grants can() reads, so it is the answer, not a description.
 */

type Holder = { user: { id: string; name: string; status: string }; role: { id: string; name: string }; scope: Scope }
type PersonAccess = { user: { id: string; name: string; status: string }; role: { name: string } | null; grants: { permission: Permission; scope: Scope }[] }
type Mode = 'permission' | 'person'

export default function WhoCanPage() {
    const { t, locale } = useLanguage()
    const isRtl = locale === 'ar'
    const { setTitle, setSubtitle } = useHeader()
    const { data: session } = useSession()
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

    const [mode, setMode] = useState<Mode>('permission')
    const [companyId, setCompanyId] = useState('')
    const [permission, setPermission] = useState('')
    const [search, setSearch] = useState('')
    const [userId, setUserId] = useState('')

    useEffect(() => {
        setTitle(t('who_can_title'))
        setSubtitle(t('who_can_hint'))
        return () => { setTitle(null); setSubtitle(null) }
    }, [t, setTitle, setSubtitle])

    const { data: companiesResult } = useSWR(isSuperAdmin ? '/api/companies?limit=100' : null, fetcher)
    const companies: { id: string; name: string }[] = companiesResult?.data?.data || companiesResult?.data || []

    const { data: holdersResult, isLoading: holdersLoading } = useSWR(
        isSuperAdmin && mode === 'permission' && companyId && permission
            ? `/api/roles/who-can?companyId=${companyId}&permission=${encodeURIComponent(permission)}` : null,
        fetcher,
    )
    const holders: Holder[] = holdersResult?.data?.holders ?? []

    const { data: peopleResult } = useSWR(
        isSuperAdmin && mode === 'person' && companyId
            ? `/api/users?companyId=${companyId}&includeDeleted=false&limit=20&search=${encodeURIComponent(search)}` : null,
        fetcher,
    )
    const people: { id: string; firstName: string; lastName: string }[] = peopleResult?.data?.data ?? []

    const { data: personResult, isLoading: personLoading } = useSWR(
        isSuperAdmin && mode === 'person' && userId ? `/api/roles/who-can?userId=${userId}` : null,
        fetcher,
    )
    const person: PersonAccess | null = personResult?.data ?? null

    if (session && !isSuperAdmin) return <AccessDenied />

    const field = { display: 'flex', flexDirection: 'column' as const, gap: '0.3rem', flex: 1, minWidth: '14rem' }
    const cell = { padding: '0.6rem 0.75rem', borderTop: '1px solid var(--veil-40)', textAlign: (isRtl ? 'right' : 'left') as 'right' | 'left' }

    return (
        <div style={{ direction: isRtl ? 'rtl' : 'ltr', display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '56rem' }}>
            <SegmentedToggle
                value={mode}
                onChange={(next: Mode) => { setMode(next); setUserId('') }}
                ariaLabel={t('who_can_title')}
                options={[
                    { value: 'permission', label: t('who_can_by_permission') },
                    { value: 'person', label: t('who_can_by_person') },
                ]}
            />

            <div className="glass" style={{ padding: '1.25rem', borderRadius: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={field}>
                    <label htmlFor="who-company">{t('who_can_company')}</label>
                    <select id="who-company" className="input" value={companyId} onChange={e => { setCompanyId(e.target.value); setUserId('') }}>
                        <option value="">—</option>
                        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                {mode === 'permission' ? (
                    <div style={field}>
                        <label htmlFor="who-permission">{t('who_can_permission')}</label>
                        <select id="who-permission" className="input" value={permission} onChange={e => setPermission(e.target.value)}>
                            <option value="">—</option>
                            {PERMISSION_GROUPS.map(g => (
                                <optgroup key={g.key} label={t(groupLabelKey(g.key))}>
                                    {g.permissions.map(p => <option key={p} value={p}>{t(permissionLabelKey(p))}</option>)}
                                </optgroup>
                            ))}
                        </select>
                    </div>
                ) : (
                    <div style={field}>
                        <label htmlFor="who-person">{t('who_can_person')}</label>
                        <input id="who-person" className="input" value={search} disabled={!companyId} onChange={e => setSearch(e.target.value)} placeholder="…" />
                        {companyId && !userId && people.length > 0 && (
                            <div style={{ border: '1px solid var(--veil-40)', borderRadius: '0.5rem', maxHeight: '14rem', overflowY: 'auto' }}>
                                {people.map(p => (
                                    <button key={p.id} type="button" onClick={() => setUserId(p.id)}
                                        style={{ display: 'block', width: '100%', textAlign: isRtl ? 'right' : 'left', padding: '0.5rem 0.75rem', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', font: 'inherit' }}>
                                        {p.firstName} {p.lastName}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="glass" style={{ padding: '1.25rem', borderRadius: '1rem' }}>
                {mode === 'permission' ? (
                    !companyId || !permission ? <p style={{ color: 'var(--text-soft)', margin: 0 }}>{t('who_can_choose')}</p>
                    : holdersLoading ? <LoadingSpinner />
                    : holders.length === 0 ? <p style={{ margin: 0 }}>{t('who_can_nobody')}</p>
                    : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={cell}>{t('who_can_person')}</th>
                                    <th style={cell}>{t('who_can_role')}</th>
                                    <th style={cell}>{t('who_can_scope')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {holders.map(h => (
                                    <tr key={h.user.id}>
                                        <td style={cell}>{h.user.name}</td>
                                        <td style={cell}>{h.role.name}</td>
                                        <td style={cell}>{t(scopeLabelKey(h.scope))}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
                ) : (
                    !userId ? <p style={{ color: 'var(--text-soft)', margin: 0 }}>{t('who_can_choose_person')}</p>
                    : personLoading || !person ? <LoadingSpinner />
                    : (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                                <strong>{person.user.name}</strong>
                                {person.role && <span style={{ color: 'var(--text-soft)' }}>{t('who_can_through').replace('{role}', person.role.name)}</span>}
                                <button type="button" onClick={() => setUserId('')} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer' }}>✕</button>
                            </div>
                            {person.grants.length === 0 ? <p style={{ margin: 0 }}>{t('who_can_holds_nothing')}</p> : (
                                PERMISSION_GROUPS.map(g => {
                                    const held = person.grants.filter(gr => g.permissions.includes(gr.permission))
                                    if (held.length === 0) return null
                                    return (
                                        <div key={g.key} style={{ marginBottom: '0.75rem' }}>
                                            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{t(groupLabelKey(g.key))}</div>
                                            {held.map(gr => (
                                                <div key={gr.permission} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderTop: '1px solid var(--veil-40)' }}>
                                                    <span>{t(permissionLabelKey(gr.permission))}</span>
                                                    <span style={{ color: 'var(--text-soft)' }}>{t(scopeLabelKey(gr.scope))}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    )
                )}
            </div>
        </div>
    )
}
