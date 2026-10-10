import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Every overlay is a dialog: it uses useDialog, so it says it is a modal
 * dialog named by its title, takes focus when it opens, keeps Tab inside,
 * closes on Escape and gives focus back (accessibility audit, 4 October
 * 2026, C2). Before, only the face camera did; the rest left focus on the
 * page behind them.
 *
 * An overlay is found by its scrim: var(--scrim) drawn inline, or the shared
 * .modal-overlay class (app/globals.css), which draws the same one. A new
 * one is caught whichever way it is written; four that used the class had
 * been missed, and behaved as no dialog at all (Codex review of #36).
 */
/** The overlays a file draws: each line opening one, by its scrim or the class that draws it. */
const scrimsIn = (s: string) => s.split("\n").filter(l => l.includes("var(--scrim)") || l.includes('className="modal-overlay"')).length
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])

/** Overlays that are their own kind of thing, with their own handling. */
const OWN = new Map([
    ["components/FaceCamera.tsx", "the camera: a dialog already, with spoken progress"],
    ["components/DatePickerSingle.tsx", "a date picker: lib/usePickerKeyboard.ts"],
    ["components/DateRangePicker.tsx", "a date picker: lib/usePickerKeyboard.ts"],
    ["components/DateTimePicker.tsx", "a date picker: lib/usePickerKeyboard.ts"],
    ["components/DashboardShell.tsx", "the phone sidebar's dimmed background, a menu drawer rather than a dialog"],
])

describe("overlays", () => {
    const overlays = [...files("app"), ...files("components")]
        .filter(f => scrimsIn(readFileSync(f, "utf8")) > 0 && !OWN.has(f))

    it.each(overlays)("%s uses useDialog for each overlay it draws", f => {
        const s = readFileSync(f, "utf8")
        const scrims = scrimsIn(s)
        const panels = s.split("panelProps}").length - 1
        expect(s).toContain("useDialog(")
        expect(panels).toBeGreaterThanOrEqual(scrims)
        // Each is named: by its heading (titleId) or, with no heading on screen, a label.
        const named = (s.split("titleId}").length - 1) + (s.match(/useDialog\(.*\{ label:/g) ?? []).length
        expect(named).toBeGreaterThanOrEqual(scrims)
    })
})

describe("useDialog", () => {
    const hook = readFileSync("lib/useDialog.ts", "utf8")

    it("gives focus back on closing a dialog drawn already open, as conditionally mounted editors are (Codex review of #36)", () => {
        // What had focus as it was first drawn, read while rendering: before an autoFocus field inside takes it.
        expect(hook).toMatch(/const \[focusedAtMount\] = useState\(\(\) =>/)
        expect(hook).toMatch(/const opener = lastOutside\.current \?\? /)
    })
})
