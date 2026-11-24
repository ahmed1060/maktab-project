import { cache } from "react"
import type { Metadata } from "next"
import { getServerSession } from "next-auth"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { isClientAccount } from "@/lib/client-session"
import { portalFrame } from "@/lib/client-portal-frame"
import { SESSION_ENDED_PATH } from "@/lib/session-ended"
import { portalTaxPosition } from "@/lib/services/tax-claim.service"
import { portalAccountant } from "@/lib/services/client-accountant.service"
import { pageSystemSettings } from "@/lib/services/system-settings.service"
import { TaxStatementPage } from "@/components/tax/TaxStatement"
import { formatDay } from "@/components/records/types"
import { resolveLocale } from "@/lib/locale"
import { statementTitle } from "@/lib/tax-statement"
import { ar } from "@/lib/translations/ar"
import { en } from "@/lib/translations/en"

export const dynamic = 'force-dynamic'

/**
 * The tax position statement, in the client's area (CLIENT_PORTAL_PLAN.md
 * §8, §12 step 12a; DESIGN.md §5.5, Tax position statement; PR 352), opened
 * in a tab of its own from Download the statement on the area's page. Its
 * client is the session's, never the address's, read as the area's page
 * reads it (portalTaxPosition): only where that client is the session's
 * company's. With it, the accountant its page names, the company's name and
 * logo, and the signature as System settings has it.
 */
export default async function PortalStatementPage() {
    const session = await getServerSession(authOptions)
    // As on the area's page: only a session the server has ended gets here without one.
    if (!session) redirect(SESSION_ENDED_PATH)
    if (!isClientAccount(session.user)) redirect('/dashboard')

    const { companyId, clientId } = session.user
    if (!companyId || !clientId) redirect(SESSION_ENDED_PATH)
    const position = await read(companyId, clientId)
    // A client deleted since the session's last check has ended it already.
    if (!position) redirect(SESSION_ENDED_PATH)
    const [accountant, frame, settings] = await Promise.all([portalAccountant(clientId), portalFrame(session.user), pageSystemSettings()])

    return (
        <TaxStatementPage
            statement={{
                company: frame?.company ?? { name: '', logoUrl: null },
                client: session.user.clientName ?? '',
                accountant: accountant?.name ?? null,
                // In the page's language (PR 418). The client's name is the
                // session's, as the area's frame has it.
                accountantAr: accountant?.nameAr,
                position,
                signature: { show: settings.showPoweredBy, name: settings.poweredByName },
            }}
            home="/portal"
        />
    )
}

/**
 * The page's title, which the browser names the PDF by (statementTitle), sent
 * with the page: Next.js sends a page's title after its content, so one set
 * in the browser alone would give way to the app's own. In the page's
 * language, as the root layout picks it; the statement sets it again in the
 * browser where the language is changed in its tab. Nothing of its own
 * before the first upload, or for anyone but the client's people.
 */
export async function generateMetadata(): Promise<Metadata> {
    const session = await getServerSession(authOptions)
    if (!session || !isClientAccount(session.user)) return {}
    const { companyId, clientId } = session.user
    if (!companyId || !clientId) return {}
    const position = await read(companyId, clientId).catch(() => null)
    if (!position?.asOf) return {}
    const locale = resolveLocale((await cookies()).get('NEXT_LOCALE')?.value, (await headers()).get('accept-language'))
    const words = locale === 'ar' ? ar : en
    return { title: statementTitle(words.tax_statement_file, session.user.clientName ?? '', formatDay(position.asOf, locale)) }
}

// Once for the page and its title, in one request.
const read = cache(async (companyId: string, clientId: string) => {
    try {
        return await portalTaxPosition({ companyId, clientId })
    } catch (e) {
        if (e instanceof Error && e.message === "CLIENT_NOT_FOUND") return null
        throw e
    }
})
