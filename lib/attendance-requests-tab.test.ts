import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The Attendance page's Requests tab, once permission hours and missing
 * punches are asked for and decided on the one Requests page (UI_PLAN.md
 * §2.3, part 3c): it points there, rather than keeping lists of its own
 * that would say the same thing twice. Overtime, phones and flagged punches
 * stay on it until part 4.
 */

const tab = readFileSync("app/(dashboard)/dashboard/attendance/RequestsTab.tsx", "utf8")

describe("the Attendance page's Requests tab", () => {
    it("points to one's own requests on the Requests page", () => {
        expect(tab).toContain('href="/dashboard/requests?tab=mine"')
        expect(tab).not.toContain("/api/attendance/permissions?mine=1")
        expect(tab).not.toContain("/api/attendance/missing-punches?mine=1")
    })

    it("points to the ones waiting on this person under To review, for whoever decides them", () => {
        expect(tab).toContain('href="/dashboard/requests?tab=review"')
        expect(tab).not.toContain("/api/attendance/permissions?${q}status=PENDING")
        expect(tab).not.toContain("/api/attendance/missing-punches?${q}status=PENDING")
    })

    it("points with a link that looks like a button: the old pages' .btn-secondary is a button's look, which a link hasn't (found in the browser)", () => {
        expect(tab).toContain('<ButtonLink href="/dashboard/requests?tab=mine"')
        expect(tab).toContain('<ButtonLink href="/dashboard/requests?tab=review"')
        expect(tab).not.toMatch(/<Link[^>]*className="btn/)
    })

    it("keeps overtime, phones and flagged punches until they move (part 4)", () => {
        expect(tab).toContain("/api/attendance/overtime?")
        expect(tab).toContain("/api/attendance/phones?")
        expect(tab).toContain("/api/attendance/flagged?")
    })

    it("still offers asking from a day, which the Days tab and the check-in page open", () => {
        expect(tab).toContain("export function AskPermissionModal(")
        expect(tab).toContain("export function ReportMissingModal(")
    })
})
