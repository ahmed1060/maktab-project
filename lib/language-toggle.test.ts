import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

// The control is presentational; what is worth pinning is the handful of
// decisions inside it that a later edit would quietly undo.

/**
 * Comments stripped before matching. Three guards in this codebase have now
 * been written against source text and passed on the prose explaining the very
 * thing they were meant to forbid — including this one, whose first version
 * matched the comment that says 11.5rem is gone.
 */
const read = (path: string) => stripComments(readFileSync(path, "utf8"))

const TOGGLE = readFileSync("components/LanguageToggleButton.tsx", "utf8")
const SCREEN = readFileSync("components/sign-in/SignInScreen.tsx", "utf8")
const LOGIN = readFileSync("app/(auth)/login/page.tsx", "utf8")

describe("each language names itself", () => {
    it("labels the options in their own language, not the current one", () => {
        // The person reaching for this control is the one who cannot read the
        // interface they are looking at. "Arabic" written in English helps
        // nobody who needs it.
        expect(TOGGLE).toContain("'English'")
        expect(TOGGLE).toContain("'العربية'")
    })

    it("does not route those labels through t()", () => {
        // Translating them would mean the Arabic build offers "الإنجليزية"
        // and "العربية" — two words in one language, which is the thing a
        // language picker must not do.
        expect(TOGGLE).not.toMatch(/label:\s*t\(/)
    })
})

describe("the option order does not move", () => {
    it("asks the control to keep its order", () => {
        expect(TOGGLE).toContain("fixedOrder")
    })

    it("pins direction rather than letting the layout mirror it", () => {
        // An RTL page mirrors a flex row, so without this the half you just
        // clicked jumps to the other end of the control the moment it takes
        // effect.
        // The building blocks' switch since the top bar moved onto them (PR 205).
        expect(read("components/ui/Segmented.tsx")).toContain("dir={fixedOrder ? 'ltr' : undefined}")
    })

    it("leaves it off by default, so page filters still mirror", () => {
        // The companies filter belongs to the page and should flip with it.
        // Only the language picker is exempt.
        expect(read("components/ui/Segmented.tsx")).toMatch(/fixedOrder\s*=\s*false/)
    })
})

describe("a switch cannot be started twice", () => {
    it("refuses a locale that is already current, and one already in flight", () => {
        expect(read("context/LanguageContext.tsx")).toContain("if (newLocale === locale || isChangingLocale) return")
    })

    it("disables the control while the switch runs", () => {
        // The provider's full-page overlay already covers this, but the control
        // should not depend on an overlay in another file to be correct.
        expect(TOGGLE).toContain("disabled={isChangingLocale}")
    })
})

describe("the sign-in screen stops hand-positioning its controls", () => {
    // Under the card, as part of the page (DESIGN.md §5.5, Sign-in): pinned
    // to the screen's corners, on a phone they covered Sign in.
    it("holds both switches in the page, under the card, instead of fixed to a corner", () => {
        expect(SCREEN).toContain('<ThemeToggleButton variant="inline" />')
        expect(SCREEN).toContain('<LanguageToggleButton />')
        expect(read("app/(auth)/login/page.tsx")).not.toContain('variant="fixed"')
        expect(LOGIN).toContain("<SignInScreen ")
    })

    it("has no hand-measured offset left in either control", () => {
        // 11.5rem was the width of the language pill, measured by eye. It had
        // to be re-derived every time either control changed size — and the
        // language control just became wider than it.
        expect(read("components/ThemeToggleButton.tsx")).not.toContain("11.5rem")
        expect(read("components/LanguageToggleButton.tsx")).not.toContain("position: 'fixed'")
    })

    it("lets them wrap rather than run off a narrow screen", () => {
        const css = read("components/ui/ui.css")
        const at = css.indexOf("\n.ui-signin-switches {")
        expect(css.slice(at, css.indexOf("}", at))).toContain("flex-wrap: wrap;")
    })
})
