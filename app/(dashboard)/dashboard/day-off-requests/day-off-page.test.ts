import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/** Day Off Requests on the building blocks (UI_PLAN.md §4.1). */

const page = readFileSync("app/(dashboard)/dashboard/day-off-requests/page.tsx", "utf8")

describe("the Day Off Requests page", () => {
    it("never leaves the list on a page that's gone, where there'd be no pager to leave it by", () => {
        expect(page).toContain("useAdjustOnChange([totalPages], () => setPage(p => pageInRange(p, totalPages)))")
    })

    it("starts another company on its first page, without the last one's employee", () => {
        expect(page).toContain("useAdjustOnChange([contextCompanyId], () => { setPage(1); setEmployeeId('') })")
    })

    it("is built from the building blocks, dialogs included", () => {
        for (const block of ["<PageHeader", "<FilterBar", "<DataList", "<ListCard", "<Pager", "<EmptyState", "<Dialog", "<Choice", "<TextArea"]) expect(page).toContain(block)
    })

    it("uses no Tailwind classes, emoji, inline styles or a pie chart", () => {
        expect(page).not.toMatch(/className="[^"]*\b(flex|text-xl|font-bold|text-slate-\d+|py-\d+|glass-card|mb-4)\b/)
        expect(page).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
        expect(page).not.toContain("style={{")
        expect(page).not.toContain("recharts")
    })

    it("opens on the status a link asks for, when it's a real one", () => {
        expect(page).toContain("const asked = searchParams.get('status')")
        expect(page).toContain("return asked && (STATUSES as readonly string[]).includes(asked) ? asked : ''")
    })

    it("offers Approve and Reject only on a pending request this person may decide", () => {
        expect(page).toContain("const decidable = (r: DayOffRequest) => canDecide && r.status === 'PENDING' && canFor('dayoff.approve', r.userId, r.user?.teamLeaderId)")
    })

    it("brings the request a notification opened into view, in whichever layout is showing", () => {
        expect(page).toContain("visibleRow(highlightId)?.scrollIntoView(")
        // On whichever page it turns up: every full page has ten requests, so
        // the list's length doesn't change from one to the next.
        expect(page).toContain("const highlightShown = !!highlightId && requests.some(r => r.id === highlightId)")
        expect(page).toContain("}, [highlightId, highlightShown])")
        expect(page).not.toContain("[highlightId, requests.length]")
        expect(page).toContain("tone={r => visualHighlightId === r.id ? 'selected' : undefined}")
    })

    it("picks salary, and says why, when the credit can't cover the days", () => {
        expect(page).toContain("const deductionType: 'CREDIT' | 'SALARY' = creditShort ? 'SALARY' : chosenDeduction")
        expect(page).toContain("{ value: 'CREDIT', label: t('deduct_from_credit'), disabled: creditShort }")
        expect(page).toContain("warning={creditShort ? t('insufficient_credit') : undefined}")
    })
})
