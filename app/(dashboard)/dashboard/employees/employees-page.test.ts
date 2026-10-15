import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/** Employees on the building blocks (UI_PLAN.md §4.1). */

const page = readFileSync("app/(dashboard)/dashboard/employees/page.tsx", "utf8")

describe("the Employees page", () => {
    it("never leaves the list on a page that's gone, where there'd be no pager to leave it by", () => {
        expect(page).toContain("useAdjustOnChange([totalPages], () => setPage(p => pageInRange(p, totalPages)))")
    })

    it("starts another company on its first page, without the last one's team or picks", () => {
        expect(page).toContain("useAdjustOnChange([selectedCompanyId], () => { setPage(1); setTeam(''); setPicked(new Set()) })")
    })

    it("is built from the building blocks: header, filter bar, list with phone cards, pager", () => {
        for (const block of ["<PageHeader", "<FilterBar", "<DataList", "<ListCard", "<Pager", "<EmptyState"]) expect(page).toContain(block)
    })

    it("uses no Tailwind classes, emoji or inline styles", () => {
        expect(page).not.toMatch(/className="[^"]*\b(flex|text-lg|font-bold|text-slate-\d+|py-\d+|glass-card)\b/)
        expect(page).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
        expect(page).not.toContain("style={{")
    })

    it("suspends from a menu item anyone can reach with the keyboard, not a clickable dot", () => {
        expect(page).not.toMatch(/<div[^>]*onClick=/)
        expect(page).toContain("label: t('suspend_employee')")
        expect(page).toContain("label: t('reactivate_employee')")
        // An ended contract is reinstated from the profile, not from the list.
        expect(page).toContain("if (isSuperAdmin && e.status !== 'ARCHIVED')")
    })

    it("names each row's checkbox and menu after the person", () => {
        expect(page).toContain("aria-label={t('ui_select_row').replace('{name}', nameOf(e))}")
        expect(page).toContain("label={t('ui_more_actions_for').replace('{name}', nameOf(e))}")
    })

    it("asks before deleting, and says so after", () => {
        expect(page).toMatch(/onSelect: \(\) => setDeleteConfirm\(\{ id: e\.id, name: nameOf\(e\) \}\)/)
        expect(page).toContain("<ConfirmModal")
        expect(page).toContain("showToast(t('employee_deleted'), 'success')")
    })

    it("asks before resetting points, which can't be undone", () => {
        expect(page).toContain("onSelect: () => setResetConfirm({ id: e.id, name: nameOf(e) }) })")
        expect(page).not.toContain("onSelect: () => resetPoints(e.id)")
        expect(page).toContain("onConfirm={() => resetConfirm && resetPoints(resetConfirm.id)}")
    })

    it("says a status in words, with its meaning's colour", () => {
        expect(page).toContain("<StatusBadge tone={STATUS_TONE[e.status] ?? 'neutral'}>")
        expect(page).toContain("<StatusBadge tone=\"waiting\">{t('team_unassigned')}</StatusBadge>")
    })
})
