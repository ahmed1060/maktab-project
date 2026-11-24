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
        expect(page).toContain("<ConfirmDialog")
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

// Employees' names in the page's language (LATER_CHANGES_PLAN.md §3.1, step 5, PR 405; DESIGN.md §5.3).
describe("the Employees page's names", () => {
    it("are each in the page's language, or the one they have", () => {
        expect(page).toContain("const nameOf = (e: PersonNames) => personName(e, locale)")
        expect(page).not.toContain("`${e.firstName} ${e.lastName}`")
        // Its list is sorted so, and searched in either.
        expect(page).toContain("lang: locale,")
    })

    it("still missing a language are counted above the filter bar, for whoever may edit people", () => {
        expect(page).toContain("const editsNames = can('employees.edit')")
        expect(page).toContain("countNames: editsNames,")
        expect(page).toContain("{editsNames && missingNames > 0 && <ListNote icon={TranslateIcon} title={countOf(t, locale, missingNames, 'one_language')}>{t('names_missing_note_body')}</ListNote>}")
        expect(page.indexOf("<ListNote")).toBeLessThan(page.indexOf("<FilterBar"))
    })

    it("are listed when they're missing a language, with what each is missing", () => {
        expect(page).toContain("{ value: '', label: t('names_filter_all') }")
        expect(page).toContain("{ value: 'missing', label: t('names_filter_missing') }")
        expect(page).toContain("names: names || undefined,")
        expect(page).toContain("...(names === 'missing' ? [{ key: 'missing', header: t('names_missing_column'), cell: missing }] : [])")
        expect(page).toContain("missingLanguages([{ en: e.firstName, ar: e.firstNameAr }, { en: e.lastName, ar: e.lastNameAr }])")
        expect(page).toContain("<StatusBadge key={language} tone=\"neutral\">{t(language === 'ar' ? 'name_missing_ar_badge' : 'name_missing_en_badge')}</StatusBadge>")
        // Side by side, and on a phone's card as one piece that wraps together.
        expect(page).toContain('<span className="ui-badge-row">')
        expect(page).toContain("...(names === 'missing' ? [{ icon: TranslateIcon, text: missing(e) }] : []),")
        // A filter like the rest: counted, and reset.
        expect(page).toContain("const filtersOn = [status, role, team, names].filter(Boolean).length")
        expect(page).toContain("setNames('');")
    })
})
