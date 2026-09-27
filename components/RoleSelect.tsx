'use client'

import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { fetcher } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'

/**
 * The Role dropdown (ROLES_PLAN.md §6.4): that company's roles, only those the
 * signed-in person may hand out — the list comes from the same rules the
 * server applies on saving (/api/roles/assignable), so it never offers a role
 * that would be refused.
 *
 * A person already on a role the viewer may not give — an Admin, seen by
 * another company Admin — shows it, and cannot change it.
 */

export type AssignableRole = { id: string; name: string; baseRole: 'ADMIN' | 'TEAM_LEADER' | 'EMPLOYEE'; builtIn: string | null; isDefault: boolean }

type Props = {
    /** The Super Admin names the company; anyone else is in their own. */
    companyId?: string | null
    value: string
    /** The role they hold now, by name, for when the viewer may not give it. */
    current?: { id: string; name: string } | null
    onChange: (roleId: string, role: AssignableRole | null) => void
    disabled?: boolean
    /** For a new account: an empty choice meaning the company's default role. */
    allowDefault?: boolean
    style?: React.CSSProperties
}

export default function RoleSelect({ companyId, value, current, onChange, disabled, allowDefault, style }: Props) {
    const { t } = useLanguage()
    // Nothing until it is known who is asking: before the session loads, a
    // Super Admin would look like anyone else and ask without a company.
    const { data: session } = useSession()
    const viewer = session?.user?.role
    const url = !viewer ? null
        : viewer === 'SUPER_ADMIN' ? (companyId ? `/api/roles/assignable?companyId=${companyId}` : null)
        : '/api/roles/assignable'
    const { data } = useSWR(url, fetcher)
    const roles: AssignableRole[] = data?.data ?? []
    const offered = roles.some(r => r.id === value)
    const locked = !!current && value === current.id && !offered && roles.length > 0

    return (
        <select
            className="input"
            value={value}
            disabled={disabled || locked}
            onChange={e => onChange(e.target.value, roles.find(r => r.id === e.target.value) ?? null)}
            style={style}
        >
            {allowDefault && (
                <option value="">
                    {t('roles_select_default')}{roles.find(r => r.isDefault) ? ` (${roles.find(r => r.isDefault)!.name})` : ''}
                </option>
            )}
            {current && !offered && <option value={current.id}>{current.name}</option>}
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
    )
}
