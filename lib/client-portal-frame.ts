import { prisma } from "@/lib/prisma"
import { isClientAccount } from "@/lib/client-session"
import { ownColour } from "@/lib/page-brand-colour"

/**
 * What the client's area's frame draws around its pages (DESIGN.md §5.5;
 * CLIENT_PORTAL_PLAN.md §5.3, §12 step 7d-1; PR 334): the company's mark and
 * name for its top bar, and its own brand colour, so the client sees the
 * office they deal with. One read of the company's row, each time a page is
 * drawn, as the dashboard reads its company's colour.
 */
export type PortalFrame = {
    /** Its name in both languages, shown in the page's (PR 409). */
    company: { name: string; nameAr: string | null; logoUrl: string | null }
    /** The company's own colour, or null for the system's default the root layout draws (UI_PLAN.md §4.6). */
    brand: string | null
}

type Viewer = { role?: unknown; companyId?: string | null } | null | undefined

/** The frame for one of a client's people's session; null for anyone else, with nothing read. */
export async function portalFrame(viewer: Viewer): Promise<PortalFrame | null> {
    if (!isClientAccount(viewer) || !viewer?.companyId) return null
    const company = await prisma.company.findUnique({
        where: { id: viewer.companyId },
        select: { name: true, nameAr: true, logoUrl: true, brandColour: true },
    })
    if (!company) return null
    return {
        company: { name: company.name, nameAr: company.nameAr, logoUrl: company.logoUrl },
        brand: ownColour({ role: viewer.role as string, companyId: viewer.companyId }, company.brandColour),
    }
}
