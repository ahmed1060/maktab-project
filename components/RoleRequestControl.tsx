'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import RoleSelect from '@/components/RoleSelect'
import { refusalOf } from '@/components/CompanyRolesCard'
import { useLanguage } from '@/context/LanguageContext'
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
    current: { id: string; name: string } | null
    /** Somebody only the Super Admin acts on (§4.2, rule 7). */
    locked?: boolean
    style?: React.CSSProperties
}

type Pending = { id: string; role: { name: string } }

export default function RoleRequestControl({ userId, companyId, current, locked, style }: Props) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [choice, setChoice] = useState(current?.id ?? '')
    const [sending, setSending] = useState(false)
    const { data, mutate } = useSWR(`/api/role-requests?userId=${userId}&status=PENDING`, fetcher)
    const pending: Pending | undefined = data?.data?.[0]

    const ask = async () => {
        setSending(true)
        try {
            const res = await fetch('/api/role-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, roleId: choice }),
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
                {current?.name ?? '—'} · <Link href={`/dashboard/role-requests?highlight=${pending.id}`}>{t('role_requests_pending_for').replace('{role}', pending.role.name)}</Link>
            </div>
        )
    }

    return (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
                <RoleSelect companyId={companyId} value={choice} current={current} locked={locked} onChange={id => setChoice(id)} style={style} />
            </div>
            <button type="button" className="btn btn-primary" onClick={ask} disabled={locked || sending || !choice || choice === current?.id}>
                {t('role_requests_ask')}
            </button>
        </div>
    )
}
