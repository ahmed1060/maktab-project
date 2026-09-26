import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { resolveLocale } from "./locale"

describe("resolveLocale", () => {
    it("a real cookie choice wins over the browser", () => {
        expect(resolveLocale("en", "ar-EG,ar;q=0.9")).toBe("en")
        expect(resolveLocale("ar", "en-US,en;q=0.9")).toBe("ar")
    })

    it("with no cookie, follows the browser's first language, as navigator.language did", () => {
        expect(resolveLocale(undefined, "ar-EG,ar;q=0.9,en;q=0.8")).toBe("ar")
        expect(resolveLocale(undefined, "ar")).toBe("ar")
        expect(resolveLocale(undefined, "AR-sa")).toBe("ar")
        expect(resolveLocale(undefined, "en-US,en;q=0.9,ar;q=0.8")).toBe("en")
        // Arabic somewhere down the list is not the first preference.
        expect(resolveLocale(undefined, "fr-FR,ar;q=0.9")).toBe("en")
    })

    it("falls back to English for anything else", () => {
        expect(resolveLocale(undefined, undefined)).toBe("en")
        expect(resolveLocale(null, "")).toBe("en")
        expect(resolveLocale("fr", null)).toBe("en")
        // A tampered cookie is not a choice; the browser decides instead.
        expect(resolveLocale("xx", "ar")).toBe("ar")
    })

    it("is what both server readers of the locale use", () => {
        // The layout picks the dictionary for the whole tree and the dashboard
        // page picks its own; if they resolved differently a screen would
        // mix languages.
        for (const path of ["app/layout.tsx", "app/(dashboard)/dashboard/page.tsx"]) {
            const src = stripComments(readFileSync(path, "utf8"))
            expect(src, path).toMatch(/resolveLocale\(\s*cookieStore\.get\('NEXT_LOCALE'\)/)
            expect(src, path).not.toMatch(/cookieStore\.get\('NEXT_LOCALE'\)\?\.value\s*\|\|/)
        }
    })

    it("the client no longer second-guesses it from navigator.language", () => {
        expect(stripComments(readFileSync("context/LanguageContext.tsx", "utf8"))).not.toContain("navigator.language")
    })
})
