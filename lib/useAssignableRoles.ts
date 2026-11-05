'use client'

import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { fetcher } from '@/lib/swr-fetcher'

/**
 * The roles the signed-in person may hand out in a company (ROLES_PLAN.md
 * §6.4), as the server decides them (/api/roles/assignable): the same rules
 * it applies on saving, so a role picker never offers one that would be
 * refused. Asking for a role offers the same ones: what one may ask for is
 * what one could give (§6.12).
 *
 * It was the old Role dropdown's, and is the building blocks' Select's now:
 * Add employee's, asking the Super Admin for a role change, and a person's
 * profile (a person's profile, part 4, PR 194).
 */

export type AssignableRole = { id: string; name: string; baseRole: 'ADMIN' | 'TEAM_LEADER' | 'EMPLOYEE'; builtIn: string | null; isDefault: boolean }

export function useAssignableRoles(companyId?: string | null, wanted = true): AssignableRole[] {
    // Nothing until it is known who is asking: before the session loads, a
    // Super Admin would look like anyone else and ask without a company. Nor
    // where no role is picked, as on a profile whose role isn't the viewer's
    // to give or ask for.
    const { data: session } = useSession()
    const viewer = session?.user?.role
    const url = !viewer || !wanted ? null
        : viewer === 'SUPER_ADMIN' ? (companyId ? `/api/roles/assignable?companyId=${companyId}` : null)
        : '/api/roles/assignable'
    const { data } = useSWR(url, fetcher)
    return data?.data ?? []
}
