'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import RoleSelect from '@/components/RoleSelect'
import { refusalOf } from '@/components/CompanyRolesCard'
import { useLanguage } from '@/context/LanguageContext'
import { roleLabel } from '@/lib/role-label'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'

/**
 * The Role field for somebody who may ask for a role but not give one — HR
 * (ROLES_PLAN.md §6.12). Picking a role and asking files a request; the person
 * keeps their role until an Admin decides, and the field says so meanwhile.
 */
type Props = {
    userId: string
    companyId: string
    current: { id: string; name: string; builtIn?: string | null } | null
    /** Somebody only the Super Admin acts on (§4.2, rule 7). */
    locked?: boolean
    style?: React.CSSProperties
}

type Pending = { id: string; role: { name: string; builtIn?: string | null } }

export default function RoleRequestControl({ userId, companyId, current, locked, style }: Props) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [choice, setChoice] = useState(current?.id ?? '')
    const [sending, setSending] = useState(false)
    // Asked for as an acting role until this date (§6.13), or permanent.
    const [actingDate, setActingDate] = useState('')
    const [tomorrow] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10))
    const { data, mutate } = useSWR(`/api/role-requests?userId=${userId}&status=PENDING`, fetcher)
    const pending: Pending | undefined = data?.data?.[0]

    const ask = async () => {
        setSending(true)
        try {
            const res = await fetch('/api/role-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, roleId: choice, actingUntil: actingDate || undefined }),
            })
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            showToast(t('role_requests_sent'), 'success')
            mutate()
        } finally {
            setSending(false)
        }
    }

    if (pending) {
        return (
            <div style={{ padding: '0.6rem 0.75rem', borderRadius: '0.75rem', background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', fontSize: '0.9rem' }}>
                {roleLabel(current, t)} · <Link href={`/dashboard/role-requests?highlight=${pending.id}`}>{t('role_requests_pending_for').replace('{role}', roleLabel(pending.role, t))}</Link>
            </div>
        )
    }

    return (
        <div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                    <RoleSelect companyId={companyId} value={choice} current={current} locked={locked} onChange={id => setChoice(id)} style={style} />
                </div>
                <button type="button" className="btn btn-primary" onClick={ask} disabled={locked || sending || !choice || choice === current?.id}>
                    {t('role_requests_ask')}
                </button>
            </div>
            {choice && choice !== current?.id && (
                <div style={{ marginTop: '0.75rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8rem' }}>{t('acting_until_label')}</label>
                    <input type="date" className="input" value={actingDate} min={tomorrow} onChange={e => setActingDate(e.target.value)} />
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-soft)', margin: '0.25rem 0 0' }}>{t('acting_until_hint')}</p>
                </div>
            )}
        </div>
    )
}
