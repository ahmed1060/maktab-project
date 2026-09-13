import { describe, it, expect } from "vitest"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

// The toggle's own behaviour is presentational, but its labels are not: a
// missing key puts the raw key in the control, and nothing in typecheck or
// build notices because a key is just a string.

describe("the companies toolbar labels exist in both locales", () => {
    for (const key of [
        'needs_attention_filter', 'show_all_companies',
        'sort_label', 'date', 'name_label',
        'subscription_state', 'nothing_needs_attention',
    ]) {
        it(key, () => {
            expect(en, `missing "${key}" in en`).toHaveProperty(key)
            expect(ar, `missing "${key}" in ar`).toHaveProperty(key)
            expect(String((en as any)[key]).trim().length).toBeGreaterThan(0)
            expect(String((ar as any)[key]).trim().length).toBeGreaterThan(0)
        })
    }

    it("the sort segments are short enough not to repeat the group label", () => {
        // "Sort by date | Sort by name" says the word twice in one control.
        // These name only what differs; the group label carries the rest.
        for (const dict of [en, ar]) {
            expect(dict.date).not.toContain(dict.sort_label)
            expect(dict.name_label).not.toContain(dict.sort_label)
        }
    })
})
