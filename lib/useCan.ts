"use client"

import { useMemo } from "react"
import { useSession } from "next-auth/react"
import { can, canCompanyWide, type Actor, type Target } from "@/lib/permissions/can"
import type { Permission } from "@/lib/permissions/catalogue"

/**
 * The signed-in person's permissions, for a screen deciding what to show.
 *
 * The same can() the routes ask, bound to the session, so a button is offered
 * exactly when the server would accept it. Nothing here is a boundary: hiding
 * a button saves somebody a refusal, and the route still decides.
 *
 * Server Components do not need this — they call can(session.user, …) directly,
 * which is the same function.
 */
export type Can = {
    /** Whether they hold this permission; with a target, for that record. */
    can: (permission: Permission, target?: Target) => boolean
    /** Whether they hold it across their whole company, not only a team. */
    companyWide: (permission: Permission) => boolean
}

export function useCan(): Can {
    const { data: session } = useSession()
    const user = session?.user as Actor | undefined
    const role = user?.role
    const id = user?.id
    const companyId = user?.companyId

    // Keyed on the fields can() reads rather than the session object, which
    // next-auth replaces on every refresh: callers put this in dependency
    // arrays, and a fresh object each time would refire their effects.
    return useMemo(() => {
        const actor: Actor | null = role ? { role, id, companyId } : null
        return {
            can: (permission, target) => !!actor && can(actor, permission, target),
            companyWide: permission => !!actor && canCompanyWide(actor, permission),
        }
    }, [role, id, companyId])
}
