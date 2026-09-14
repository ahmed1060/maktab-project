import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { stripComments } from "./strip-comments"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

// Comments stripped before matching, as everywhere else in this repo: the
// prose explaining why alert() and the emoji are gone names both of them.
const read = (path: string) => stripComments(readFileSync(path, "utf8"))

const HEALTH = read("app/(dashboard)/dashboard/health/page.tsx")

/** Every page and component in the product, so neither guard below is scoped to one screen. */
function walkPages(dir = "app", out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walkPages(path, out)
        else if (entry.endsWith(".tsx")) out.push(path)
    }
    if (dir === "app") for (const entry of readdirSync("components", { recursive: true }) as string[]) {
        const path = join("components", entry)
        if (statSync(path).isFile() && path.endsWith(".tsx")) out.push(path)
    }
    return out
}
const NOTICE = read("components/NoticeModal.tsx")

describe("results are reported in the application's own theme", () => {
    it("leaves no native alert() anywhere in the product", () => {
        // Started as a check on one page -- the 16 calls behind the message a
        // Super Admin saw after deleting 97 files, which opened as a
        // browser-chrome grey box on a dark page. The other 13 were spread over
        // five pages and had exactly the same problem, so the guard is the
        // whole app rather than the page that happened to be reported.
        //
        // Both spellings: window.alert() was the more common of the two.
        const offenders: string[] = []
        for (const file of walkPages()) {
            stripComments(readFileSync(file, "utf8")).split("\n").forEach((line, i) => {
                if (/(^|[^.\w])alert\(|\bwindow\.alert\(/.test(line)) {
                    offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 70)}`)
                }
            })
        }
        expect(offenders, `native alert():\n${offenders.join("\n")}`).toEqual([])
    })

    it("mounts the modal on every page that reports one", () => {
        // setNotice without <NoticeModal /> in the tree is a silent no-op: the
        // state changes and nothing appears. Worse than the alert() it replaced.
        const missing = walkPages()
            .map(file => ({ file, code: stripComments(readFileSync(file, "utf8")) }))
            .filter(({ code }) => code.includes("setNotice({"))
            .filter(({ code }) => !code.includes("<NoticeModal"))
            .map(({ file }) => file)

        expect(missing, `sets a notice but never renders one:\n${missing.join("\n")}`).toEqual([])
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
