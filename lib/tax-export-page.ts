import type { TaxFileRefusal } from "./tax-file-read"
import type { TranslationKey } from "./translations"

/**
 * The tax portal's export button's page (CLIENT_PORTAL_PLAN.md §10, §12 step
 * 4b; DESIGN.md §5.5, The tax portal's export button; PR 319): where it is,
 * and what it says, as words to be looked up. Its drawing is
 * components/tax/TaxExportButton.tsx.
 */

/**
 * The page's address. It isn't in the side bar: How to get the portal's
 * file links to it, on a client's Tax position and in the upload's dialogs
 * (components/tax/TaxExportLink.tsx; step 4c, PR 320).
 */
export const TAX_EXPORT_PAGE = "/dashboard/tax-export"

/** Why the upload refuses a file whole: the file itself, or that the client's claims couldn't be read to check it against. */
export type TaxRefusalProblem = TaxFileRefusal["problem"] | "unchecked"

/** What a file is refused for that isn't the file's doing: its reader didn't load, or the client's claims couldn't be read. */
const NOT_THE_FILE: readonly TaxRefusalProblem[] = ["reader", "unchecked"]

/**
 * Whether it's the file that's at fault, where the upload refuses one whole
 * (§10, step 4c). How to get the portal's file is there then, and not
 * otherwise: another file wouldn't help.
 */
export function fileAtFault(problem: TaxRefusalProblem): boolean {
    return !NOT_THE_FILE.includes(problem)
}

/**
 * What the tax portal and the button's panel call things, written as they
 * have them, in Arabic, in either language: the portal's Payments page, and
 * the panel's line once all is gathered, its Gather all pages and its
 * Download. The panel's are in lib/tax-export-button.ts, word for word.
 */
export const TAX_PORTAL_WORDS = {
    payments: "المدفوعات",
    gathered: "اتجمعت كل النتائج",
    gather: "سحب كل الصفحات",
    download: "تنزيل Excel",
} as const

/** How the button is used, in order: each step's title, where it's done, and what to do, a line each. */
export const TAX_EXPORT_STEPS: readonly { title: TranslationKey; where: TranslationKey; lines: readonly TranslationKey[] }[] = [
    { title: "tax_export_step_open", where: "tax_export_where_portal", lines: ["tax_export_step_open_line"] },
    { title: "tax_export_step_filter", where: "tax_export_where_portal", lines: ["tax_export_step_filter_line"] },
    { title: "tax_export_step_press", where: "tax_export_where_browser", lines: ["tax_export_step_press_line", "tax_export_step_press_done"] },
    { title: "tax_export_step_download", where: "tax_export_where_panel", lines: ["tax_export_step_download_line"] },
    { title: "tax_export_step_upload", where: "tax_export_where_nizmo", lines: ["tax_export_step_upload_line"] },
]

/** What to know (§10): one company and one filter to a file, what a filter hides, that the file is what the portal shows when it's saved, and that nothing is sent or kept. */
export const TAX_EXPORT_NOTES: readonly TranslationKey[] = ["tax_export_know_one", "tax_export_know_filter", "tax_export_know_now", "tax_export_know_sends"]
