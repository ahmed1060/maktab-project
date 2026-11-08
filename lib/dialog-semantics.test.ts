import { describe, it, expect, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Every overlay is a dialog: it uses useDialog, so it says it is a modal
 * dialog named by its title, takes focus when it opens, keeps Tab inside,
 * closes on Escape and gives focus back (accessibility audit, 4 October
 * 2026, C2). Before, only the face camera did; the rest left focus on the
 * page behind them.
 *
 * An overlay is found by its scrim: var(--scrim) drawn inline. The shared
 * .modal-overlay class drew the same one, and four that used it had been
 * missed, behaving as no dialog at all (Codex review of #36); it went with
 * the old styles (PR 223).
 */
/** The overlays a file draws: each line opening one, by its scrim. */
const scrimsIn = (s: string) => s.split("\n").filter(l => l.includes("var(--scrim)")).length
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])

/** Overlays that are their own kind of thing, with their own handling. */
const OWN = new Map([
    // The date fields draw no dimmed page of their own: their calendar is
    // components/ui/Calendar.tsx, whose phone layer is in ui.css.
    ["components/DashboardShell.tsx", "the phone sidebar's dimmed background, a menu drawer rather than a dialog"],
])

describe("overlays", () => {
    const overlays = [...files("app"), ...files("components")]
        .filter(f => scrimsIn(readFileSync(f, "utf8")) > 0 && !OWN.has(f))

    // Every dialog is the building blocks' (components/ui/Dialog.tsx), whose
    // dimmed page is in its stylesheet. The older pages' window, the last
    // overlay a page drew of its own, went in PR 222: one drawn of its own
    // again is held to the same.
    it("the building blocks' dialog uses useDialog", () => {
        expect(readFileSync("components/ui/Dialog.tsx", "utf8")).toContain("useDialog(open, onClose)")
    })

    it("each overlay a page draws of its own uses useDialog", () => {
        for (const f of overlays) {
            const s = readFileSync(f, "utf8")
            const scrims = scrimsIn(s)
            const panels = s.split("panelProps}").length - 1
            expect(s, f).toContain("useDialog(")
            expect(panels, f).toBeGreaterThanOrEqual(scrims)
            // Each is named: by its heading (titleId) or, with no heading on screen, a label.
            const named = (s.split("titleId}").length - 1) + (s.match(/useDialog\(.*\{ label:/g) ?? []).length
            expect(named, f).toBeGreaterThanOrEqual(scrims)
        }
    })
})

describe("useDialog", () => {
    const hook = readFileSync("lib/useDialog.ts", "utf8")

    it("gives focus back on closing a dialog drawn already open, as conditionally mounted editors are (Codex review of #36)", () => {
        // What had focus as it was first drawn, read while rendering: before an autoFocus field inside takes it.
        expect(hook).toMatch(/const \[focusedAtMount\] = useState\(\(\) =>/)
        expect(hook).toMatch(/const opener = lastOutside\.current \?\? /)
    })

    it("takes focus back when it's lost while open, as a busy button turns itself off (Codex review of #168)", async () => {
        // A delete that failed left its dialog open, but the busy Delete had
        // turned itself off and the browser dropped focus to the page: Escape
        // no longer closed it and Tab walked the page behind.
        const { regainFocus } = await import("./focus-trap")
        const body = {}
        const panel = { focus: vi.fn() }
        expect(regainFocus(panel, body, body)).toBe(true)
        expect(regainFocus(panel, null, body)).toBe(true)
        expect(panel.focus).toHaveBeenCalledTimes(2)
        // Not when focus is somewhere, in the dialog or a pop-up opened from it.
        expect(regainFocus(panel, { tagName: "BUTTON" }, body)).toBe(false)
        expect(regainFocus(null, body, body)).toBe(false)
        expect(panel.focus).toHaveBeenCalledTimes(2)
        // After every redraw while open, once its first focus is placed, so opening still lands on the first field.
        expect(hook).toMatch(/useEffect\(\(\) => \{\s*if \(isOpen && settled\.current\) regainFocus\(ref\.current, document\.activeElement, document\.body\)\s*\}\)/)
        expect(hook).toMatch(/settled\.current = true/)
    })
})
