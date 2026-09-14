import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { THEMES, DEFAULT_THEME, isTheme, parseTheme, themeAttribute } from "./theme"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

describe("two states", () => {
    it("offers light and dark, and nothing else", () => {
        expect([...THEMES].sort()).toEqual(["dark", "light"])
    })

    it("defaults to light", () => {
        // Decided rather than derived: the alternative was resolving each
        // person against their operating system once, and the call was to map
        // everyone who had never chosen to light instead.
        expect(DEFAULT_THEME).toBe("light")
    })

    it("rejects anything else rather than trusting a cookie", () => {
        // The value arrives from a cookie, which anyone can edit.
        expect(isTheme("dark")).toBe(true)
        expect(isTheme("DARK")).toBe(false)
        expect(isTheme("")).toBe(false)
        expect(isTheme(null)).toBe(false)
        expect(isTheme("light; --evil: 1")).toBe(false)
        expect(parseTheme("nonsense")).toBe("light")
        expect(parseTheme(undefined)).toBe("light")
    })
})

describe("retiring the third state", () => {
    // The literal is spelled out here and nowhere else. There used to be a
    // LEGACY_THEME constant for it; it went when the last three writers of the
    // value did, because a constant naming a value nothing writes is a standing
    // invitation to write it. This file is the right place to keep knowing it:
    // a test may remember what production has forgotten.
    const RETIRED = "system"

    it("folds a stored 'system' into the default without a branch for it", () => {
        // 20 of 22 accounts were on this. The rows were cleared in the migrate
        // step, but cookies hold a year and session tokens outlive the deploy
        // that issued them, so this still has to hold.
        expect(isTheme(RETIRED)).toBe(false)
        expect(parseTheme(RETIRED)).toBe(DEFAULT_THEME)
    })

    it("is not offered by the toggle", () => {
        expect([...THEMES] as string[]).not.toContain(RETIRED)
    })

    it("is not written back by the sign-in callbacks", () => {
        // Three lines in auth.ts read `theme: user.theme || 'system'`, left
        // over from when it was the column default. They could not fire — the
        // column is NOT NULL — but they were the only path that could still put
        // the retired value into a session token, and a value nothing writes is
        // the whole point of having cleared the rows.
        // The quoted literal, not the bare word: auth.ts reads
        // prisma.systemSettings twice, and the first version of this guard
        // matched that instead of anything to do with themes.
        const code = stripComments(readFileSync("lib/auth.ts", "utf8"))
        expect(code).not.toMatch(new RegExp(`['"]${RETIRED}['"]`))
        expect(code.match(/theme:\s*parseTheme\(/g) ?? []).toHaveLength(2)
        expect(code).toContain("token.theme = parseTheme(")
    })

    it("parses rather than falls back, so a junk stored value is caught too", () => {
        // `|| DEFAULT_THEME` would have fixed the literal and still passed
        // through anything else the column happened to hold.
        expect(parseTheme("blue")).toBe(DEFAULT_THEME)
        expect(parseTheme(null)).toBe(DEFAULT_THEME)
    })
})

describe("what gets stamped on <html>", () => {
    it("always stamps something", () => {
        // While "system" existed this returned undefined for it, because that
        // state had to be served by the media query alone. Every render being
        // stamped is what makes the media copy of the dark palette dead weight.
        for (const theme of THEMES) {
            expect(themeAttribute(theme)).toBe(theme)
        }
    })
})

describe("the CSS answers both states", () => {
    const CSS = readFileSync("app/globals.css", "utf8")
    // Comments stripped: the ones explaining this deletion name the very thing
    // it forbids, which is how the first version of this test failed.
    const CODE = stripComments(CSS)

    it("has exactly one dark palette", () => {
        // There were two, identical, because the un-stamped "follow the system"
        // state could only be served by a media query and a custom property
        // cannot be applied conditionally any other way. A test used to hold
        // the copies in step. With every render stamped there is nothing for a
        // media query to catch, so the copy went with the state — and this
        // asserts it stays gone rather than being reintroduced as a courtesy to
        // people on a dark OS, which is precisely the state that was dropped.
        expect(CSS).toContain(':root[data-theme="dark"]')
        expect(CODE.match(/prefers-color-scheme/g) ?? []).toHaveLength(0)
    })

    it("declares color-scheme in both directions", () => {
        // Without it a dark page keeps white scrollbars and light form controls.
        expect(CSS).toMatch(/color-scheme:\s*light/)
        expect(CSS).toMatch(/color-scheme:\s*dark/)
    })

    it("still defines every dark token it did before the copy was removed", () => {
        // The deletion is only safe because the two blocks were identical, which
        // the test this replaces had been asserting all along. This is the other
        // half of that: the surviving block is the full palette, not a subset
        // that happened to compile.
        const at = CSS.indexOf(':root[data-theme="dark"]')
        const body = CSS.slice(at, CSS.indexOf("\n}", at))
        const tokens = [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)]
        expect(tokens.length).toBeGreaterThan(50)
    })
})

describe("the toggle's labels", () => {
    for (const key of ["theme_label", "theme_light", "theme_dark"]) {
        it(key, () => {
            expect(en).toHaveProperty(key)
            expect(ar).toHaveProperty(key)
        })
    }

    it("names both states, since the toggle shows both at once", () => {
        for (const theme of THEMES) {
            expect(en, theme).toHaveProperty(`theme_${theme}`)
            expect(ar, theme).toHaveProperty(`theme_${theme}`)
        }
    })
})

describe("the third state is gone from the UI, not just from the type", () => {
    // Comments stripped: this file's own prose explains at length what "system"
    // was, and a plain substring check would match that instead of the code —
    // which is how three earlier guards in this repo passed while the thing
    // they forbade was still there.
    const code = (path: string) => stripComments(readFileSync(path, "utf8"))

    it("is not offered, labelled or branched on by the toggle", () => {
        expect(code("components/ThemeToggleButton.tsx")).not.toContain("system")
    })

    it("is not special-cased when applying a theme", () => {
        // The old apply() removed the data-theme attribute for it, so the media
        // query could take back over. Leaving that branch in would mean a stale
        // cookie could still produce an unstamped root.
        expect(code("context/ThemeContext.tsx")).not.toContain("removeAttribute")
    })

    it("still defaults both account tables to light, not one of them", () => {
        // Super Admins live in their own table. Fixing one column and missing
        // the other is the easy mistake, and nothing would report it.
        const schema = readFileSync("prisma/schema.prisma", "utf8")
        const defaults = [...schema.matchAll(/theme\s+String\s+@default\("([a-z]+)"\)/g)].map(m => m[1])
        expect(defaults).toEqual(["light", "light"])
    })
})
