/**
 * Whose module names a screen is showing.
 *
 * Rule 3 — a company's own users see their own company's names — needs nothing:
 * the maps are on their session. This file exists for rule 1: a Super Admin
 * scoped to one company sees *that* company's names, and a Super Admin belongs
 * to no company, so there is nothing on their session to read.
 *
 * The selection is carried in a cookie rather than fetched, for the reason
 * NEXT_LOCALE is: it is the only way a Server Component can know it before the
 * first byte is rendered. A selection read from localStorage in an effect is
 * null on the first render, which means the sidebar paints the default names
 * and then corrects itself — the same flash dark mode is stamped server-side to
 * avoid. It also keeps one source: the layout resolves this once and hands it
 * down, so the sidebar and the page body cannot disagree about which company
 * they are describing.
 */

/** Mirrors CompanyContext's selection. A company id, or absent for "all". */
export const SCOPED_COMPANY_COOKIE = "scopedCompanyId"

/**
 * What a scoped screen renders with. Deliberately the same shape the session
 * carries, so `modulesFrom` takes either without knowing which it got.
 */
export type CompanyBranding = {
    moduleLabels: unknown
    moduleIcons: unknown
    logoUrl: string | null
}

/**
 * Whether this viewer may be scoped to another company's branding at all.
 *
 * The cookie is written by the browser and can say anything. It is not a
 * credential and grants nothing — a Super Admin can already see every company —
 * but that is exactly why the check belongs here, once, rather than being left
 * as a property of who happens to call it. Anyone else reads their own session
 * and the cookie is ignored.
 */
export function mayScopeBranding(role: string | null | undefined): boolean {
    return role === "SUPER_ADMIN"
}

/**
 * The company whose branding a request should render with, or null for "use the
 * session" — which covers a Super Admin on All Companies (rule 2: do not
 * customise a screen that is showing everybody) and every non-Super-Admin
 * (rule 3).
 */
export function scopedCompanyId(
    role: string | null | undefined,
    cookieValue: string | null | undefined
): string | null {
    if (!mayScopeBranding(role)) return null
    const id = cookieValue?.trim()
    // "ALL" is what CompanyContext stores for no selection; an empty cookie is
    // the same thing said differently.
    if (!id || id === "ALL") return null
    return id
}
