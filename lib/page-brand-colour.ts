import { prisma } from "@/lib/prisma"
import { SystemSettingsService } from "@/lib/services/system-settings.service"
import { DEFAULT_BRAND, isBrandHex } from "@/lib/brand-colour"

/**
 * The brand colour a page opens in (UI_PLAN.md §4.6, DESIGN.md §2.1).
 *
 * A company's people see its colour, or the system's default if it has none.
 * The sign-in page, which has nobody signed in, and the Super Admin's pages
 * use the default.
 *
 * Drawn in two places, because Next.js doesn't draw the root layout again
 * when the app moves to another page without a reload:
 * - the root layout draws the default, which is the same for everyone, so
 *   it's right whoever is signed in by then;
 * - the dashboard layout draws a company's own colour over it. Moving
 *   between the sign-in page and the dashboard draws that layout afresh, so
 *   signing out leaves the company's colour behind and signing in brings it.
 *
 * Both are read when the page is drawn. Whoever saves a colour sees it at
 * once (the settings card asks for the page again); everyone else sees it
 * the next time they open or reload a page, or sign in.
 */

type Viewer = { role?: string | null; companyId?: string | null }

/** The company's own colour this viewer sees, or null for the default. */
export function ownColour(viewer: Viewer | null | undefined, companyColour: string | null | undefined): string | null {
    const own = viewer && viewer.role !== "SUPER_ADMIN" && viewer.companyId ? companyColour : null
    return isBrandHex(own) ? own : null
}

/** The stored default, or Nizmo's indigo if it isn't usable. */
export function usableDefault(systemColour: string | null | undefined): string {
    return isBrandHex(systemColour) ? systemColour : DEFAULT_BRAND
}

/**
 * The default, for the root layout. Never throws: a page that can't read the
 * setting opens in Nizmo's indigo rather than not at all.
 */
export async function defaultBrandColour(): Promise<string> {
    try {
        return usableDefault((await SystemSettingsService.get()).brandColour)
    } catch {
        return DEFAULT_BRAND
    }
}

/**
 * The viewer's company's own colour, for the dashboard layout, or null when
 * the default applies. Never throws: null leaves the page in the default.
 */
export async function companyBrandColour(viewer: Viewer | null | undefined): Promise<string | null> {
    const companyId = viewer && viewer.role !== "SUPER_ADMIN" ? viewer.companyId : null
    if (!companyId) return null
    try {
        const company = await prisma.company.findUnique({ where: { id: companyId }, select: { brandColour: true } })
        return ownColour(viewer, company?.brandColour)
    } catch {
        return null
    }
}
