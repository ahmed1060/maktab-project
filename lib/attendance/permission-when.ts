import type { TranslationKey } from "@/lib/translations"
import { countOf } from "@/lib/plural"
import type { PolicyBody } from "./policy"

/**
 * What the policy's card says of when permission hours may be asked for
 * (LATER_CHANGES_PLAN.md §7.4, 4b; DESIGN.md §5.5): before, or up to its hours
 * after; only in advance, with none after; or any day, from last month to a
 * month ahead.
 */
export function permissionWhenLine(t: (key: TranslationKey) => string, locale: string, rules: Pick<PolicyBody["permissionHours"], "when" | "afterTheFactHours">): string {
    if (rules.when === "ANY_DAY") return t("attendance_permission_when_ANY_DAY")
    if (rules.afterTheFactHours === 0) return t("attendance_permission_when_ahead_line")
    return t("attendance_permission_when_around_line").replace("{hours}", countOf(t, locale, rules.afterTheFactHours, "hours"))
}
