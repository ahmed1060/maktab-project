"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { useLanguage } from "@/context/LanguageContext"
import { resolveTitleKey, buildTitle } from "@/lib/page-title"

/**
 * Sets the browser tab title per route: "Nizmo — Obligations" rather than
 * "Nizmo" on all thirty-five dashboard pages. Renders nothing.
 *
 * Why a client component rather than a `metadata` export per page: twenty-seven
 * of the dashboard's pages are Client Components, and a Client Component cannot
 * export metadata at all. The alternative is a layout.tsx beside each one —
 * twenty-seven new files whose titles would then be frozen in English, because
 * `metadata` is static while this app's locale is a runtime cookie. One mount
 * point that reads the live locale gets both, and a page behind a login has no
 * SEO to lose by having its title set client-side.
 */
export default function PageTitle({ vendorsLabel }: { vendorsLabel?: string | null }) {
    const pathname = usePathname()
    const { t, locale } = useLanguage()

    useEffect(() => {
        const key = resolveTitleKey(pathname || "")

        // The vendors tab is renamed per company; the tab title should say what
        // the sidebar says rather than the generic word.
        const section = key === "vendors" && vendorsLabel
            ? vendorsLabel
            : key
                ? t(key as any)
                : null

        document.title = buildTitle(section || null)
        // locale is a dependency so the title follows a language switch.
    }, [pathname, locale, t, vendorsLabel])

    return null
}
