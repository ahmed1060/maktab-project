import { describe, it, expect } from "vitest"
import { codeCandidates, codeError, normaliseCode } from "@/lib/username-code"

/**
 * Each company's own username code (the letters before the number): what's
 * suggested from its name, and what's accepted when one is typed. 2 to 8
 * English letters, stored in lower case.
 */

describe("a company's username code", () => {
    it("is suggested from the name's initials first, then letters from its last word, then a letter more", () => {
        const offered = codeCandidates("Delta Systems")
        expect(offered[0]).toBe("ds")
        expect(offered.indexOf("dsy")).toBeGreaterThan(0)
        expect(offered).toContain("dsa")
        expect(offered.every(code => /^[a-z]{2,8}$/.test(code))).toBe(true)
        expect(new Set(offered).size).toBe(offered.length)
    })

    it("never suggests a single letter: a one-word name starts with its first two letters", () => {
        const offered = codeCandidates("Karavan")
        expect(offered[0]).toBe("ka")
        expect(offered).not.toContain("k")
        expect(offered.slice(0, 3)).toEqual(["ka", "kar", "kara"])
    })

    it("spells an Arabic name in English letters", () => {
        const offered = codeCandidates("شركة النور")
        expect(offered[0]).toBe("sha")
        expect(offered.every(code => /^[a-z]{2,8}$/.test(code))).toBe(true)
    })

    it("keeps to 8 letters for a long name, and still suggests something for a name with no letters", () => {
        expect(codeCandidates("A B C D E F G H I J")[0]).toBe("abcdefgh")
        const none = codeCandidates("123 456")
        expect(none.length).toBeGreaterThan(0)
        expect(none.every(code => /^[a-z]{2,8}$/.test(code))).toBe(true)
    })

    it("accepts 2 to 8 English letters, capitals and spaces around them aside", () => {
        expect(normaliseCode("  DS ")).toBe("ds")
        expect(codeError("ds")).toBeNull()
        expect(codeError(" Ds ")).toBeNull()
        expect(codeError("abcdefgh")).toBeNull()
        for (const wrong of ["", "a", "abcdefghi", "ds1", "d s", "دس", "d-s"]) expect(codeError(wrong), wrong).toBe("companies_code_invalid")
    })
})
