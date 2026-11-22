'use client'

import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import { useCompany } from '@/context/CompanyContext'
import { fetcher } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import type { SelectOption } from '@/components/ui'

type Person = { id: string; firstName: string; lastName: string; role: string }

/**
 * A list's employee filter: All employees, then the people whose items it
 * can show. The server keeps a Team Leader's to their team, and a Super
 * Admin's are the company they're looking at. Nothing is asked for when
 * `on` is false, as for someone who sees only their own, nor for whoever may
 * not see employees, whom the list would refuse: then there are no options,
 * and the list shows no person filter (UI_PLAN.md, 2026-11-22; PR 368).
 */
export function useEmployeeOptions(on = true): SelectOption[] | null {
    const { t } = useLanguage()
    const { data: session } = useSession()
    const { selectedCompanyId } = useCompany()
    const { can } = useCan()
    const asks = on && can('employees.view')
    const superAdmin = (session?.user as { role?: string } | undefined)?.role === 'SUPER_ADMIN'
    const { data } = useSWR(asks && session ? `/api/users?limit=1000${superAdmin && selectedCompanyId ? `&companyId=${selectedCompanyId}` : ''}` : null, fetcher)
    if (!asks) return null
    const people: Person[] = data?.data?.data || []
    return [
        { value: '', label: t('all_employees') },
        // Admins are assigned no tasks and add no costs of their own.
        ...people.filter(p => p.role !== 'ADMIN' && p.role !== 'SUPER_ADMIN').map(p => ({ value: p.id, label: `${p.firstName} ${p.lastName}`.trim() })),
    ]
}
