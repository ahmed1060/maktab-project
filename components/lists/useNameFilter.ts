'use client'

import useSWR from 'swr'
import type { ListKind } from '@prisma/client'
import { useSession } from 'next-auth/react'
import { useCompany } from '@/context/CompanyContext'
import { useLanguage } from '@/context/LanguageContext'
import { fetcher } from '@/lib/swr-fetcher'
import type { ExtraFilter } from '@/components/locations/usePlaceFilters'

type FilterName = { id: string; name: string; archived: boolean }

/**
 * A saved name's filter (CLIENTS_PLAN.md §5.9) for the filter bar: a title
 * on the Tasks page, a cost name on the Costs page, from the address's
 * `key`. It keeps what was picked as the name or typed the same. The
 * archived names come last, marked, as what was picked as them is still to
 * be found. A Super Admin picks a company first; set in the address before
 * then, it's hidden, so it can be cleared. With no names, there's nothing
 * to pick, and no select.
 */
export function useNameFilter(kind: ListKind, key: 'titleNameId' | 'costNameId', value: string): ExtraFilter[] {
    const { t } = useLanguage()
    const { data: session } = useSession()
    const { selectedCompanyId } = useCompany()
    const superAdmin = (session?.user as { role?: string } | undefined)?.role === 'SUPER_ADMIN'
    const waits = !session || (superAdmin && !selectedCompanyId)
    const company = superAdmin && selectedCompanyId ? `&companyId=${encodeURIComponent(selectedCompanyId)}` : ''
    const { data } = useSWR<{ data: FilterName[] }>(waits ? null : `/api/lists?kind=${kind}&pick=filters${company}`, fetcher)
    const names = data?.data ?? []
    const label = t(kind === 'TASK_TITLE' ? 'lists_filter_title' : 'lists_filter_cost_name')

    if (waits || names.length === 0) return value ? [{ key, label, value, options: [], hidden: true }] : []
    const named = (list: FilterName[], mark: (name: string) => string) => list.map(n => ({ value: n.id, label: mark(n.name) }))
    return [{
        key,
        label,
        value,
        options: [
            { value: '', label: t(kind === 'TASK_TITLE' ? 'lists_filter_all_titles' : 'lists_filter_all_cost_names') },
            ...named(names.filter(n => !n.archived), n => n),
            ...named(names.filter(n => n.archived), n => `${n} · ${t('lists_archived_mark')}`),
        ],
    }]
}
