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
 * An overlay is found by its scrim (var(--scrim)), which every one of them
 * draws, so a new one written by hand is caught too.
 */
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
    // The shared ones first; the hand-built ones in the pages follow.
    const overlays = ["components/Modal.tsx", "components/ConfirmModal.tsx", "components/NoticeModal.tsx", "components/BackupPickerModal.tsx"]
    void files; void OWN

    it.each(overlays)("%s uses useDialog for each overlay it draws", f => {
        const s = readFileSync(f, "utf8")
        const scrims = s.split("var(--scrim)").length - 1
        const panels = s.split("panelProps}").length - 1
        expect(s).toContain("useDialog(")
        expect(panels).toBeGreaterThanOrEqual(scrims)
        expect(s.split("titleId}").length - 1).toBeGreaterThanOrEqual(scrims)
    })
})
