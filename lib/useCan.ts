"use client"

import { useMemo } from "react"
import { useSession } from "next-auth/react"
import { can, canCompanyWide, grantFor, type Actor, type Target } from "@/lib/permissions/can"
import type { Permission, Scope } from "@/lib/permissions/catalogue"

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
    /**
     * How far it reaches: TEAM, COMPANY, "ALL" for a Super Admin, or null. For
     * a screen that shows a team view where others see the company's.
     */
    scope: (permission: Permission) => Scope | "ALL" | null
}

/**
 * The same answers for an actor already in hand — for a Client Component whose
 * Server Component parent passed the viewer's role down. Those render with it
 * on the first paint, where the session hook has not loaded yet, so asking the
 * hook instead would hide their buttons for a moment on every visit.
 */
export function permissionsOf(actor: Actor | null | undefined): Can {
    const who = actor?.role ? actor : null
    return {
        can: (permission, target) => !!who && can(who, permission, target),
        companyWide: permission => !!who && canCompanyWide(who, permission),
        scope: permission => who ? grantFor(who, permission) : null,
    }
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
    return useMemo(() => permissionsOf(role ? { role, id, companyId } : null), [role, id, companyId])
}
