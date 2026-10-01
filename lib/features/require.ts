import { deserializeAccess, hasModule, bundlesFor, type Bundle, type FeatureAccess, type Module } from "./bundles"

/**
 * The server-side gate. One helper, called from the API layer; gating logic
 * scattered across dozens of files is how this rots.
 *
 * `onDeny` has no default, deliberately. Two treatments are in play and the
 * standing risk is somebody picking the wrong one by accident, so the choice is
 * required at every call site — forgetting to choose should not compile.
 *
 *   'lock' — the module surface. A nav entry or a whole page for a bundle they
 *            do not have stays visible and locked, with an upgrade prompt. That
 *            is the sales surface, and it is where a customer should see what
 *            they are missing. Denials are counted (see logLockedAttempt).
 *
 *   'hide' — an individual action inside a feature they already own, such as
 *            the penalty button on a task. A locked button buried in a page they
 *            own reads as a broken screen, not an upsell.
 */
export type DenyTreatment = 'lock' | 'hide'

export type FeatureDenial = {
    allowed: false
    module: Module
    /** Any one of these would open it. */
    bundles: readonly Bundle[]
    treatment: DenyTreatment
}

export type FeatureGrant = { allowed: true }

export type FeatureDecision = FeatureGrant | FeatureDenial

/**
 * @param session a NextAuth session; its user carries the resolved access.
 */
export function requireFeature(
    session: any,
    module: Module,
    options: { onDeny: DenyTreatment }
): FeatureDecision {
    const access = accessFromSession(session)
    if (hasModule(access, module)) return { allowed: true }
    return { allowed: false, module, bundles: bundlesFor(module), treatment: options.onDeny }
}

/**
 * The access a session carries. Super Admin is resolved here rather than at the
 * token, so it holds even for a session minted before this shipped.
 */
export function accessFromSession(session: any): FeatureAccess {
    if (session?.user?.role === 'SUPER_ADMIN') {
        return { unrestricted: true, bundles: new Set(['COMPANY_MANAGEMENT', 'HR']) }
    }
    return deserializeAccess(session?.user?.featureAccess)
}

/** Convenience for the common "may this session use this module" question. */
export function sessionHasModule(session: any, module: Module): boolean {
    return hasModule(accessFromSession(session), module)
}
