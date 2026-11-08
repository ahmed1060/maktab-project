import { describe, it, expect } from "vitest"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { LAYER } from "./layers"

/**
 * The six old components no page used any more are gone (PR 222): the old
 * filter panel and its searchable select, the obligation's card, the pager,
 * the sort control and the older pages' window. Every page had moved onto the
 * building blocks (UI_PLAN.md §5), which do each of their jobs: the filter bar
 * (components/ui/FilterBar.tsx, with components/filters), the pager
 * (components/ui/Pager.tsx) and the dialog (components/ui/Dialog.tsx).
 *
 * What only they used went with them: the obligation card's highlight timer
 * (lib/useTemporaryHighlight.ts) and its pulse, the filter panel's rule for a
 * phone, the words only they said, and the older pages' window's layer.
 */

const GONE = [
    "components/EmployeeFilter.tsx",
    "components/SearchableSelect.tsx",
    "components/ObligationCard.tsx",
    "components/Pagination.tsx",
    "components/SortControl.tsx",
    "components/Modal.tsx",
    "lib/useTemporaryHighlight.ts",
]

const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (e.name === "node_modules" ? [] : sources(join(dir, e.name)))
        : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [])

describe("the six old components no page used any more", () => {
    it("are gone, with the highlight timer only the obligation's card used", () => {
        for (const file of GONE) expect(existsSync(file), file).toBe(false)
    })

    it("are imported by nothing", () => {
        // Every import and every import(), by the alias or by a relative path.
        const gone = new Set(GONE.map(f => f.replace(/\.tsx?$/, "")))
        const importers: string[] = []
        for (const file of ["app", "components", "lib", "context"].flatMap(sources)) {
            for (const m of stripComments(readFileSync(file, "utf8")).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g)) {
                const spec = m[1]
                const path = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? join(dirname(file), spec) : null
                if (path && gone.has(path.replace(/\.tsx?$/, ""))) importers.push(`${file}: ${spec}`)
            }
        }
        expect(importers).toEqual([])
    })

    it("take the obligation card's pulse and the filter panel's rule for a phone with them", () => {
        const css = readFileSync("app/globals.css", "utf8")
        for (const gone of [".highlight-pulse", "highlight-pulse-animation", ".toolbar-action"]) expect(css, gone).not.toContain(gone)
    })

    it("take the words only they said with them, in both languages", () => {
        const only = [
            "ascending", "descending", "filter_by_employee", "filter_by_status", "go_to_page", "loading_filters",
            "no_matches_found", "placeholder_all_employees", "placeholder_all_statuses", "reset_filters",
            "search_placeholder", "show_results",
        ]
        for (const key of only) {
            expect(key in en, `en: ${key}`).toBe(false)
            expect(key in ar, `ar: ${key}`).toBe(false)
        }
        // The Tasks page's status filter builds this one from the status, so it stays.
        expect(en.status_pending_confirmation).toBe("Pending Confirmation")
        expect(ar.status_pending_confirmation).toBeTruthy()
    })

    it("take the older pages' window's layer with them", () => {
        expect(Object.keys(LAYER)).toEqual(["confirm", "codePrompt"])
    })
})
