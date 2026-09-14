import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

// Comments stripped before matching, as everywhere else in this repo: the
// prose explaining why alert() and the emoji are gone names both of them.
const read = (path: string) => stripComments(readFileSync(path, "utf8"))

const HEALTH = read("app/(dashboard)/dashboard/health/page.tsx")
const NOTICE = read("components/NoticeModal.tsx")

describe("results are reported in the application's own theme", () => {
    it("leaves no native alert() on the page that raises them", () => {
        // 16 of them, and the one the Super Admin saw after deleting 97 files
        // opened as a browser-chrome grey box on a dark page.
        expect(HEALTH).not.toMatch(/(^|[^.\w])alert\(/)
    })

    it("routes every outcome through the same modal", () => {
        expect(HEALTH).toContain("<NoticeModal")
        // Success and failure both, rather than only the happy path being
        // dressed up and errors left as native dialogs.
        expect(HEALTH).toMatch(/variant: 'success'/)
        expect(HEALTH).toMatch(/variant: 'error'/)
    })

    it("takes every colour from a token, so it follows the theme", () => {
        // A literal here is how the old dialog looked wrong in dark mode in
        // the first place. Hex, rgb()/rgba() and the CSS named colours that
        // actually get reached for.
        const literals = NOTICE.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|['"](?:white|black|gray|grey)['"]/g) ?? []
        expect(literals).toEqual([])
        expect(NOTICE).toContain("var(--surface)")
    })

    it("can be dismissed from the keyboard, as alert() could", () => {
        expect(NOTICE).toContain("e.key === 'Escape'")
        expect(NOTICE).toContain("dismissRef.current?.focus()")
    })
})

describe("no control restores a hardcoded white on mouse-out", () => {
    // Four buttons set a token background and then reset it to literal
    // "white" when the pointer left, so in dark mode they turned white and
    // stayed that way. A background, not a text colour: white text on an
    // accent fill is correct in both themes.
    const FILES = [
        "components/ConfirmModal.tsx",
        "components/EmployeeFilter.tsx",
        "components/EmployeeProfileForm.tsx",
        "components/DashboardHeader.tsx",
    ]

    for (const file of FILES) {
        it(file, () => {
            expect(read(file)).not.toMatch(/style\.background\s*=\s*['"](?:white|#fff)/i)
        })
    }
})

describe("the preference rows carry no decorative icon", () => {
    it("drops the globe and the palette that sat beside the toggles", () => {
        expect(read("components/LanguageToggleButton.tsx")).not.toContain("🌐")
        expect(read("components/ThemeToggleButton.tsx")).not.toContain("🎨")
    })

    it("stops laying the row out around an icon that is no longer there", () => {
        // space-between with one child pushes the control to an edge that
        // depends on the reading direction.
        for (const file of ["components/LanguageToggleButton.tsx", "components/ThemeToggleButton.tsx"]) {
            expect(read(file), file).not.toContain("justifyContent: 'space-between'")
        }
    })
})

describe("the delete outcome says what it did", () => {
    it("is translated in both languages", () => {
        expect(en).toHaveProperty("orphans_deleted_msg")
        expect(ar).toHaveProperty("orphans_deleted_msg")
    })

    it("keeps both placeholders in both languages", () => {
        // Interpolation is a .replace() at the call site, so a translation
        // that drops a placeholder silently prints nothing rather than failing.
        for (const [name, dict] of [["en", en], ["ar", ar]] as const) {
            const copy = (dict as any).orphans_deleted_msg as string
            expect(copy, name).toContain("{count}")
            expect(copy, name).toContain("{size}")
        }
    })
})
