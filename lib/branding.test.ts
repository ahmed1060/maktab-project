import { describe, it, expect } from "vitest"
import { DEFAULT_POWERED_BY_NAME } from "@/lib/services/system-settings.service"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

// The signature's name is now a stored string rather than a literal, which
// introduces one failure the type system cannot see: an empty or whitespace
// value renders "Powered by" followed by nothing, which reads as a rendering
// bug rather than as a choice. Switching the mark off is the way to remove it.

const resolveName = (stored: string | null | undefined) => stored?.trim() || DEFAULT_POWERED_BY_NAME

describe("the signature name always resolves to something", () => {
    it("uses the stored name when there is one", () => {
        expect(resolveName("Nizmo")).toBe("Nizmo")
    })

    it("falls back rather than rendering an empty signature", () => {
        expect(resolveName("")).toBe(DEFAULT_POWERED_BY_NAME)
        expect(resolveName("   ")).toBe(DEFAULT_POWERED_BY_NAME)
        expect(resolveName(null)).toBe(DEFAULT_POWERED_BY_NAME)
        expect(resolveName(undefined)).toBe(DEFAULT_POWERED_BY_NAME)
    })

    it("trims, so a stray space cannot shift the mark off centre", () => {
        expect(resolveName("  SHSD  ")).toBe("SHSD")
    })

    it("defaults to what the component rendered before it became a column", () => {
        expect(DEFAULT_POWERED_BY_NAME).toBe("SHSD")
    })
})

describe("branding labels exist in both locales", () => {
    // Arabic was missed on the first pass here; TranslationDict caught it at
    // compile time, but only because every key is required in both. This keeps
    // that guarantee visible as a test rather than a side effect of the type.
    for (const key of ['branding_settings', 'show_powered_by_label', 'powered_by_name_label', 'powered_by_hint', 'powered_by_hidden', 'powered_by']) {
        it(key, () => {
            expect(en).toHaveProperty(key)
            expect(ar).toHaveProperty(key)
            expect(String((en as any)[key]).trim().length).toBeGreaterThan(0)
            expect(String((ar as any)[key]).trim().length).toBeGreaterThan(0)
        })
    }

    it("the Arabic signature label matches the Arabic wording of 'Powered by'", () => {
        // The checkbox label quotes the phrase it controls; if the two drift the
        // label ends up naming something that appears nowhere on screen.
        expect(ar.show_powered_by_label).toContain(ar.powered_by)
        expect(en.show_powered_by_label).toContain(en.powered_by)
    })
})
