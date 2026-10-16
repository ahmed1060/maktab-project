import { prisma } from "@/lib/prisma"
import { SystemSettingsService } from "@/lib/services/system-settings.service"
import { DEFAULT_BRAND, isBrandHex } from "@/lib/brand-colour"

/**
 * The brand colour a page opens in (UI_PLAN.md §4.6, DESIGN.md §2.1).
 *
 * A company's people see its colour, or the system's default if it has none.
 * The sign-in page, which has nobody signed in, and the Super Admin's pages
 * use the default. Read for each request, like the "Powered by" mark, so a
 * change shows on the next page anybody opens.
 */

type Viewer = { role?: string | null; companyId?: string | null }

/** Which stored colour this viewer sees. Nizmo's indigo if neither is usable. */
export function colourFor(viewer: Viewer | null | undefined, companyColour: string | null | undefined, systemColour: string | null | undefined): string {
    const own = viewer && viewer.role !== "SUPER_ADMIN" && viewer.companyId ? companyColour : null
    if (isBrandHex(own)) return own
    return isBrandHex(systemColour) ? systemColour : DEFAULT_BRAND
}

/**
 * The colour for the page being rendered. Never throws: a page that can't
 * read the setting opens in Nizmo's indigo rather than not at all.
 */
export async function pageBrandColour(viewer: Viewer | null | undefined): Promise<string> {
    try {
        const companyId = viewer && viewer.role !== "SUPER_ADMIN" ? viewer.companyId : null
        const company = companyId
            ? await prisma.company.findUnique({ where: { id: companyId }, select: { brandColour: true } })
            : null
        // The default is only needed when the company hasn't chosen one.
        if (isBrandHex(company?.brandColour)) return colourFor(viewer, company.brandColour, null)
        const { brandColour } = await SystemSettingsService.get()
        return colourFor(viewer, null, brandColour)
    } catch {
        return DEFAULT_BRAND
    }
}
