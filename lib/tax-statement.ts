import type { PortalTaxPosition } from "./portal-tax"
import type { TaxClaimRow } from "./tax-claims"

/**
 * The tax position statement (CLIENT_PORTAL_PLAN.md §8, §12 step 12;
 * DESIGN.md §5.5, Tax position statement; PR 352): a client's tax position
 * as a document, to print or save as a PDF, as the owner's mockup draws it.
 * It's drawn from the claims as they are: nothing is kept or sent. No
 * database here: the page reads what it's given.
 */

/** What a statement is drawn from. */
export type TaxStatement = {
    /** Its name in both languages, shown in the page's (PR 409). */
    company: { name: string; nameAr?: string | null; logoUrl: string | null }
    client: string
    /** The responsible accountant's name, where the client's page names one. */
    accountant: string | null
    /** As the client's page reads it, today being the company's own. */
    position: PortalTaxPosition
    /** "Powered by", as System settings has it. */
    signature: { show: boolean; name: string }
}

/** What the company's people's statement reads of a client (taxStatementOf; PR 353). */
export type StaffTaxStatement = {
    client: string
    company: { name: string; nameAr: string | null; logoUrl: string | null }
    position: PortalTaxPosition
}

export type StatementStatus = "late" | "partly_paid" | "not_due"

/** A claim's status on the statement: Late, with Partly paid under it where some is paid; Partly paid alone; or Not due yet. */
export function statementStatuses(claim: Pick<TaxClaimRow, "daysLate" | "paidAmount">): StatementStatus[] {
    const partly = claim.paidAmount > 0
    if (claim.daysLate > 0) return partly ? ["late", "partly_paid"] : ["late"]
    return partly ? ["partly_paid"] : ["not_due"]
}

/**
 * The page's title, which the browser names the PDF by: the client, the
 * statement and the day the figures are from, from its words in the page's
 * language, on one line.
 */
export function statementTitle(words: string, client: string, date: string): string {
    const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()
    return oneLine(words.replace("{client}", oneLine(client)).replace("{date}", date))
}
