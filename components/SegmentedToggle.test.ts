import { describe, it, expect } from "vitest"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

// The toggle's own behaviour is presentational, but its labels are not: a
// missing key puts the raw key in the control, and nothing in typecheck or
// build notices because a key is just a string.

// The Companies list moved off the toggle onto tabs and a sort select (the
// Super Admin's pages part 3a); its labels are still checked here.
describe("the companies list's tab and sort labels exist in both locales", () => {
    for (const key of [
        'needs_attention_filter', 'companies_tab_all',
        'companies_sort', 'companies_sort_date', 'companies_sort_name',
        'subscription_state', 'nothing_needs_attention',
    ]) {
        it(key, () => {
            expect(en, `missing "${key}" in en`).toHaveProperty(key)
            expect(ar, `missing "${key}" in ar`).toHaveProperty(key)
            expect(String((en as any)[key]).trim().length).toBeGreaterThan(0)
            expect(String((ar as any)[key]).trim().length).toBeGreaterThan(0)
        })
    }

    it("the sort options are short enough not to repeat the select's label", () => {
        // "Sort by date | Sort by name" says the word twice in one control.
        for (const dict of [en, ar]) {
            expect(dict.companies_sort_date).not.toContain(dict.companies_sort)
            expect(dict.companies_sort_name).not.toContain(dict.companies_sort)
        }
    })
})
