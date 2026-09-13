"use client"

import { useMemo } from "react"
import { useSession } from "next-auth/react"
import { useLanguage } from "@/context/LanguageContext"
import { modulesFrom, type ResolvedModules } from "@/lib/modules"
import { useCompanyBranding } from "@/context/CompanyBrandingContext"

/**
 * What this company calls each module, and which emoji it uses for it.
 *
 * Read from the session rather than fetched, for the same reason featureAccess
 * is: every screen in the app needs it, on first paint, and a fetch per screen
 * would mean the sidebar renders "Vendors" for a moment before becoming
 * "Suppliers". lib/auth.ts refreshes both maps on the same 60s throttle as
 * everything else on the token, so a rename lands within a minute without a
 * re-login.
 *
 * Nothing here is a boundary. A module's name is presentation; what a company
 * may actually *open* is decided by useFeatures/requireFeature.
 */
export function useModules(): ResolvedModules {
    const { data: session } = useSession()
    const { t, locale } = useLanguage()
    // §7.5 rule 1: when the dashboard layout has scoped this render to one
    // company, that company's names win over the session's. Null — which is
    // every non-Super-Admin, and a Super Admin on All Companies — falls through
    // to the session, which is rules 2 and 3.
    const scoped = useCompanyBranding()

    const user = session?.user as { moduleLabels?: unknown; moduleIcons?: unknown } | undefined
    const source = scoped ?? user
    const rawLabels = source?.moduleLabels
    const rawIcons = source?.moduleIcons

    // Memoized so the returned object is referentially stable: several callers
    // put it in a useEffect dependency array, and a fresh object every render
    // would make those effects fire on every render.
    return useMemo(
        () => modulesFrom({ moduleLabels: rawLabels, moduleIcons: rawIcons }, t),
        // `t` is a fresh closure on every LanguageContext render but returns the
        // same strings for a given locale, so `locale` is the honest dependency;
        // listing `t` would defeat the memo entirely.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [rawLabels, rawIcons, locale]
    )
}
