import { countOf } from "./plural"
import type { TranslationKey } from "./translations"
import type { SalaryAdvanceFacts } from "./requests/kinds"
import { moneyText, type AdvanceClosed, type PayrollMonth } from "./salary-advance"

/**
 * A salary advance's words on the Requests page (LATER_CHANGES_PLAN.md §7.5,
 * step 3a, PR 449; DESIGN.md §5.5, Asking for a salary advance): its row's
 * line, a payroll month by name, and why one can't be asked for. Pure, for
 * the page and the dialog alike.
 */

const dateLocale = (locale: string) => (locale === "ar" ? "ar-EG" : "en-GB")

/** A payroll month by its month and year: "November 2026", «نوفمبر ٢٠٢٦». */
export function payrollMonthName(locale: string, m: PayrollMonth, withYear = true): string {
    return new Intl.DateTimeFormat(dateLocale(locale), { month: "long", ...(withYear ? { year: "numeric" as const } : {}), timeZone: "UTC" })
        .format(new Date(Date.UTC(m.year, m.month - 1, 1)))
}

/** A row's line: "10,000.00 EGP over 6 months, from November 2026 payroll". */
export function advanceLine(t: (key: TranslationKey) => string, locale: string, a: SalaryAdvanceFacts): string {
    return t("salary_advance_row")
        .replace("{amount}", moneyText(a.amountMinor, locale))
        .replace("{months}", countOf(t, locale, a.months, "months"))
        .replace("{month}", payrollMonthName(locale, a.first))
}

/** Why one can't be asked for, in the dialog's words. */
export function closedText(t: (key: TranslationKey) => string, locale: string, closed: AdvanceClosed): string {
    const num = (n: number) => n.toLocaleString(dateLocale(locale))
    switch (closed.reason) {
        case "SERVICE": {
            const date = new Date(`${closed.from}T00:00:00Z`).toLocaleDateString(dateLocale(locale), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
            return t("salary_advance_closed_SERVICE").replace("{months}", countOf(t, locale, closed.months, "months")).replace("{date}", date)
        }
        case "OPEN": return t(closed.status === "APPROVED" ? "salary_advance_closed_OPEN_APPROVED" : "salary_advance_closed_OPEN_PENDING")
        case "NO_SALARY": return t("salary_advance_closed_NO_SALARY")
        case "NO_NET": return t("salary_advance_closed_NO_NET")
        case "DEBTS": return t("salary_advance_closed_DEBTS").replace("{percent}", num(closed.percent))
    }
}

