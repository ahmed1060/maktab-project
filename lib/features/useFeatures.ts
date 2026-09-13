"use client"

import { useSession } from "next-auth/react"
import { useMemo } from "react"
import { accessFromSession } from "./require"
import { hasModule, bundleFor, type Module } from "./bundles"

/**
 * The client-side half: one hook, read from the session the app already holds.
 *
 * It answers the same question as the server gate off the same data, so the two
 * cannot disagree — but it is presentation only. Nothing here is a security
 * boundary: withStandardHandler refuses the request regardless of what the
 * browser believes, which is what actually enforces a package.
 */
export function useFeatures() {
    const { data: session } = useSession()

    return useMemo(() => {
        const access = accessFromSession(session)
        return {
            access,
            /** Whether this module may be used at all. */
            has: (module: Module) => hasModule(access, module),
            /** The bundle to name in an upgrade prompt. */
            bundleFor,
            /**
             * True only when a package is actually assigned — a grandfathered
             * company holds everything but has bought nothing, and a screen that
             * says "included in your package" to one of those is lying.
             */
            isPackaged: !access.unrestricted,
        }
    }, [session])
}
