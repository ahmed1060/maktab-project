'use client'

import { useCallback } from 'react'
import { useSession } from 'next-auth/react'
import type { ListKind } from '@prisma/client'
import { useLanguage } from '@/context/LanguageContext'
import { fetcher } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import type { ListedName } from '@/components/ui'

/**
 * What a name picker needs from a company's saved list (CLIENTS_PLAN.md §5):
 * its names as someone types, and "+ Add" for whoever may add one. A Super
 * Admin's are the company they've picked; with none picked, nothing is added.
 */
export function useListNames(kind: ListKind, companyId?: string | null) {
    const { t } = useLanguage()
    const { can } = useCan()
    const { data: session } = useSession()
    const superAdmin = (session?.user as { role?: string } | undefined)?.role === 'SUPER_ADMIN'
    const company = superAdmin && companyId ? companyId : null

    const suggest = useCallback(async (typed: string): Promise<ListedName[]> => {
        if (superAdmin && !company) return []
        const params = new URLSearchParams({ kind, q: typed })
        if (company) params.set('companyId', company)
        const body = await fetcher(`/api/lists?${params}`)
        return Array.isArray(body?.data) ? body.data : []
    }, [kind, superAdmin, company])

    const add = useCallback(async (name: string): Promise<ListedName> => {
        const res = await fetch('/api/lists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind, name, ...(company ? { companyId: company } : {}) }),
        })
        const body = await res.json().catch(() => null)
        if (!res.ok || !body?.data) throw new Error(body?.error || t('lists_add_failed'))
        return body.data
    }, [kind, company, t])

    return { suggest, onAdd: can('lists.add') && (!superAdmin || !!company) ? add : undefined }
}
