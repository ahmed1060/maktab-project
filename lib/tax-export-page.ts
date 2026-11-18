import type { TranslationKey } from "./translations"

/**
 * The tax portal's export button's page (CLIENT_PORTAL_PLAN.md §10, §12 step
 * 4b; DESIGN.md §5.5, The tax portal's export button; PR 319): where it is,
 * and what it says, as words to be looked up. Its drawing is
 * components/tax/TaxExportButton.tsx.
 */

/** The page's address. It isn't in the side bar: the upload links to it. */
export const TAX_EXPORT_PAGE = "/dashboard/tax-export"

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
