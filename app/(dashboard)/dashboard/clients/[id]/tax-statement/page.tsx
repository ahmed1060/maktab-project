import { cache } from "react"
import type { Metadata } from "next"
import { getServerSession } from "next-auth"
import { cookies, headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import { accountRefusal } from "@/lib/account-refusal"
import { can, type Actor } from "@/lib/permissions/can"
import { SESSION_ENDED_PATH } from "@/lib/session-ended"
import { taxStatementOf } from "@/lib/services/tax-claim.service"
import { portalAccountant } from "@/lib/services/client-accountant.service"
import { pageSystemSettings } from "@/lib/services/system-settings.service"
import { resolveLocale } from "@/lib/locale"
import { statementTitle, type StaffTaxStatement } from "@/lib/tax-statement"
import { ar } from "@/lib/translations/ar"
import { en } from "@/lib/translations/en"
import { formatDay } from "@/components/records/types"
import { TaxStatementPage } from "@/components/tax/TaxStatement"
import AccessDenied from "@/components/AccessDenied"

export const dynamic = 'force-dynamic'

const NOT_THEIRS = new Set(["CLIENT_NOT_FOUND", "TAX_CLIENT_REQUIRED"])

/**
 * A client's tax position statement, for the company's people
 * (CLIENT_PORTAL_PLAN.md §8, §12 step 12b; DESIGN.md §5.5, Tax position
 * statement; PR 353), opened in a tab of its own from Download the statement
 * on the client's Tax position. The client's own statement (PR 352), in the
 * app's frame: the same figures, read as the client's area reads them, for
 * whoever may see tax positions. Close goes back to the client's page.
 */
export default async function ClientTaxStatementPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const opened = await open(id)
    if (opened.kind === "ended") redirect(SESSION_ENDED_PATH)
    if (opened.kind === "refused") return <AccessDenied />
    if (opened.kind === "missing") notFound()
    const { statement } = opened
    const [accountant, settings] = await Promise.all([portalAccountant(id), pageSystemSettings()])

    return (
        <TaxStatementPage
            statement={{
                company: statement.company,
                client: statement.client,
                accountant: accountant?.name ?? null,
                position: statement.position,
                signature: { show: settings.showPoweredBy, name: settings.poweredByName },
            }}
            home={`/dashboard/clients/${id}`}
        />
    )
}

/**
 * The page's title, which the browser names the PDF by, sent with the page,
 * as the client's own statement's is (app/(portal)/portal/statement): in the
 * page's language, once the portal's file has been uploaded, for whoever may
 * see it. The app's own title for each page leaves it as it is
 * (lib/page-title.ts, ownsItsTitle).
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
    const { id } = await params
    const opened = await open(id).catch(() => null)
    if (opened?.kind !== "statement" || !opened.statement.position.asOf) return {}
    const locale = resolveLocale((await cookies()).get('NEXT_LOCALE')?.value, (await headers()).get('accept-language'))
    const words = locale === 'ar' ? ar : en
    return { title: statementTitle(words.tax_statement_file, opened.statement.client, formatDay(opened.statement.position.asOf, locale)) }
}

type Opened = { kind: "ended" } | { kind: "refused" } | { kind: "missing" } | { kind: "statement"; statement: StaffTaxStatement }

// Once for the page and its title, in one request: who's signed in, and the
// client's statement if it's theirs to see.
const open = cache(async (clientId: string): Promise<Opened> => {
    const session = await getServerSession(authOptions)
    if (!session?.user) return { kind: "ended" }
    // Refused as the APIs refuse it, before anything is read: suspended,
    // archived, banned, lapsed or under maintenance, or not allowed to see it.
    if (accountRefusal(session.user) || !can(session.user as Actor, "tax.view")) return { kind: "refused" }
    try {
        return { kind: "statement", statement: await taxStatementOf(session.user as Actor, clientId) }
    } catch (error) {
        // Not there, or another company's: the same answer. Anything else,
        // such as the database being down, is a real error.
        if (error instanceof Error && NOT_THEIRS.has(error.message)) return { kind: "missing" }
        throw error
    }
})
