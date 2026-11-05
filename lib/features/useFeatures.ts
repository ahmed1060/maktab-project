"use client"

import { useMemo } from "react"
import { useViewer } from "@/lib/useCan"
import { accessFromSession } from "./require"
import { hasModule, bundlesFor, type Module } from "./bundles"

/**
 * The client-side half: one hook, read from the session the app already holds.
 *
 * It answers the same question as the server gate off the same data, so the two
 * cannot disagree — but it is presentation only. Nothing here is a security
 * boundary: withStandardHandler refuses the request regardless of what the
 * browser believes, which is what actually enforces a package.
 *
 * Read from the account the layout passed until the session has loaded, as
 * permissions are (useViewer): the session hook alone is empty for the first
 * second, and an empty one includes everything, so what the package leaves
 * out showed and went.
 */
export function useFeatures() {
    const viewer = useViewer()
    // Keyed on what accessFromSession reads, rather than the user object,
    // which next-auth replaces on every refresh.
    const role = viewer?.role
    const featureAccess = (viewer as { featureAccess?: unknown } | null)?.featureAccess

    return useMemo(() => {
        const access = accessFromSession({ user: { role, featureAccess } })
        return {
            access,
            /** Whether this module may be used at all. */
            has: (module: Module) => hasModule(access, module),
            /** The bundles to name in an upgrade prompt. */
            bundlesFor,
            /**
             * True only when a package is actually assigned — a grandfathered
             * company holds everything but has bought nothing, and a screen that
             * says "included in your package" to one of those is lying.
             */
            isPackaged: !access.unrestricted,
        }
    }, [role, featureAccess])
}
