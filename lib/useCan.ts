"use client"

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react"
import { useSession } from "next-auth/react"
import type { Session } from "next-auth"
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
    /**
     * Whether they may do this to the person with this id in their own
     * company — for a decision about somebody, where who it is matters: nobody
     * approves their own leave or sets their own pay. Pass who leads them for
     * a permission that can be held for a team, or a team-scoped grant can
     * only ever match the viewer themselves.
     */
    canFor: (permission: Permission, userId: string | null | undefined, teamLeaderId?: string | null) => boolean
}

/**
 * The same answers for an actor already in hand — the full signed-in user,
 * grants included, never one rebuilt from a role name: grants are what a role
 * holds, and a role's name says nothing about them.
 */
export function permissionsOf(actor: Actor | null | undefined): Can {
    const who = actor?.role ? actor : null
    return {
        can: (permission, target) => !!who && can(who, permission, target),
        companyWide: permission => !!who && canCompanyWide(who, permission),
        scope: permission => who ? grantFor(who, permission) : null,
        canFor: (permission, userId, teamLeaderId) => !!who && !!userId && can(who, permission, { companyId: who.companyId, userId, teamLeaderId: teamLeaderId ?? null }),
    }
}

/**
 * The signed-in person as the dashboard layout read them on the server, grants
 * included. The session hook has nothing on the first paint — it loads after —
 * so without this every screen would render without its buttons and then grow
 * them a moment later.
 */
const ViewerContext = createContext<Actor | null>(null)

export function ViewerProvider({ viewer, children }: { viewer: Actor | null | undefined; children: ReactNode }) {
    return createElement(ViewerContext.Provider, { value: viewer ?? null }, children)
}

/**
 * Who is signed in: the session once it has loaded, since it is the one that
 * refreshes; the layout's copy until then. For a screen that asks who someone
 * is (their role, their id) on its first paint: the session hook alone is
 * empty for the first second, and a page that read it showed "Access
 * Restricted" to a Super Admin until it arrived, then drew itself again.
 */
export function useViewer(): Session["user"] | null {
    const { data: session, status } = useSession()
    const fromLayout = useContext(ViewerContext) as Session["user"] | null
    // Only while it loads. Signed out or expired, the session is empty too,
    // and the layout's copy would then keep a page open to somebody who is
    // no longer signed in.
    if (status === "loading") return fromLayout
    return session?.user?.role ? session.user : null
}

export function useCan(): Can {
    const user = useViewer() as Actor | null
    const role = user?.role
    const id = user?.id
    const companyId = user?.companyId
    const grants = user?.grants

    // Keyed on the fields can() reads rather than the session object, which
    // next-auth replaces on every refresh: callers put this in dependency
    // arrays, and a fresh object each time would refire their effects.
    return useMemo(() => permissionsOf(role ? { role, id, companyId, grants } : null), [role, id, companyId, grants])
}
