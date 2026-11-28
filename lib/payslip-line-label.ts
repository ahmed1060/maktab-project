import type { TranslationKey } from "@/lib/translations"
import { PAYROLL_DEDUCTION_SOURCES } from "@/lib/payroll-deductions"

/**
 * What a payslip line is called, in the page's language, where Nizmo named
 * it: attendance's lines by their category, and income tax and social
 * insurance (LATER_CHANGES_PLAN.md §7.12, PR 440). Everything else as it was
 * stored, which for a company's own deduction is the name it gave it.
 */
export function payslipLineLabel(
    line: { label: string; source?: string | null; sourceId?: string | null },
    t: (key: TranslationKey) => string,
): string {
    if (line.source === "ATTENDANCE" && line.sourceId) return t(`attpay_line_${line.sourceId}` as TranslationKey) || line.label
    if (line.source === PAYROLL_DEDUCTION_SOURCES.INCOME_TAX) return t("payslip_line_income_tax") || line.label
    if (line.source === PAYROLL_DEDUCTION_SOURCES.SOCIAL_INSURANCE) return t("payslip_line_social_insurance") || line.label
    return line.label
}
