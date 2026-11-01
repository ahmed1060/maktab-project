import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Attendance's Import and Employee numbers on the building blocks (UI_PLAN.md
 * §5 step 5, part 6): the file, its date order and its columns in one card
 * with what it holds before Import; the files imported as rows; the numbers
 * waiting for a person as a list (DESIGN.md §5.4); numbers saved by hand in
 * a form; and withdrawing a file or removing a number in the building blocks'
 * dialog.
 */

const state = {
    locale: "en" as "en" | "ar",
    imports: {} as { data?: unknown; error?: unknown },
    codes: {} as { data?: unknown; error?: unknown },
    search: "tab=import",
}
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: "ADMIN" } }, status: "authenticated" }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
const GRANTS = new Set(["attendance.view_team", "attendance.correct"])
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (p: string) => GRANTS.has(p), companyWide: (p: string) => GRANTS.has(p), canFor: (p: string) => GRANTS.has(p) }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null, setSelectedCompanyId: () => {} }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        const idle = { data: undefined, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
        if (key?.startsWith("/api/attendance/people")) {
            return { ...idle, data: { data: { today: "2026-10-31", people: [{ id: "u1", name: "Hana Saad", teamLeaderId: null }, { id: "u2", name: "Sami Nabil", teamLeaderId: null }] } } }
        }
        if (key?.startsWith("/api/attendance/imports")) return { ...idle, ...state.imports }
        if (key?.startsWith("/api/attendance/codes")) return { ...idle, ...state.codes }
        return idle
    },
}))
vi.mock("swr/infinite", () => ({ default: () => ({ data: undefined, mutate: async () => {}, size: 1, setSize: () => {} }) }))
vi.mock("next/navigation", () => ({
    useSearchParams: () => new URLSearchParams(state.search),
    usePathname: () => "/dashboard/attendance",
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}))

const IMPORTS = {
    imports: [
        { id: "i1", fileName: "october.xlsx", createdAt: "2026-10-15T09:00:00Z", rowCount: 15, addedCount: 12, duplicateCount: 3, refusedCount: 0, voidedAt: null, voidReason: null },
        { id: "i2", fileName: "branch-b.xlsx", createdAt: "2026-10-01T09:00:00Z", rowCount: 4, addedCount: 4, duplicateCount: 0, refusedCount: 0, voidedAt: "2026-10-02T09:00:00Z", voidReason: "Wrong branch" },
    ],
}
const CODES = {
    unmatched: [{ code: "117", punches: 2, from: "2026-10-16", to: "2026-10-16" }],
    mapped: [{ id: "m1", code: "101", userId: "u2", name: "Sami Nabil" }, { id: "m2", code: "100", userId: "u1", name: "Hana Saad" }],
}
const shown = (x: unknown) => x === "loading" ? {} : x === "failed" ? { error: Object.assign(new Error("Request failed"), { info: { error: "Database unavailable" } }) } : { data: { data: x } }

async function page({ tab = "import", imports = IMPORTS as unknown, codes = CODES as unknown, locale = "en" as "en" | "ar" } = {}) {
    state.locale = locale
    state.search = `tab=${tab}`
    state.imports = shown(imports)
    state.codes = shown(codes)
    const { default: AttendancePage } = await import("@/app/(dashboard)/dashboard/attendance/page")
    const html = renderToStaticMarkup(h(AttendancePage))
    return html.slice(html.indexOf('<div role="tabpanel" id="attendance-panel"'))
}
const card = (html: string, title: string) => {
    const at = html.indexOf(`<h2 class="ui-card-title">${title}</h2>`)
    return at < 0 ? "" : html.slice(html.lastIndexOf('<section class="ui-panel ui-card"', at), html.indexOf("</section>", at))
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-01T01:00:00Z"))
})
afterEach(() => { vi.useRealTimers() })

describe("importing a file", () => {
    it("is one card: what it's for, the file picker, how its dates are written, and Check the file", async () => {
        const part = card(await page(), "Import a file")
        expect(part).toContain(`<p class="ui-card-note">${en.punch_import_hint}</p>`)
        expect(part).toContain('<div class="ui-file-drop">')
        expect(part).toContain("Choose a file</button>")
        expect(part).toContain('class="ui-label">Dates written as</label>')
        expect(part).toContain('<option value="DMY" selected="">Day/Month/Year</option>')
        // Nothing to check until a file is picked.
        expect(part).toMatch(/<button type="button" class="ui-btn ui-btn-secondary" disabled="">Check the file<\/button>/)
        expect(part).not.toContain('class="input"')
    })
})

describe("what a file holds, before it's imported", () => {
    const report = {
        fileName: "october.xlsx", headers: ["Emp No", "Date", "Time", "State"], columns: { code: 0, date: 1, time: 2, direction: 3 },
        rowCount: 15, ready: 14, duplicates: 2, locked: 1, problems: [{ row: 9, code: null, error: "NO_CODE" }], problemCount: 1,
        codes: [{ code: "117", userId: null, name: null, rows: 2 }, { code: "118", userId: null, name: null, rows: 1 }, { code: "101", userId: "u2", name: "Sami Nabil", rows: 11 }],
        from: "2026-10-01", to: "2026-10-15",
    }
    const view = async (locale: "en" | "ar" = "en", r: unknown = report) => {
        state.locale = locale
        const { ImportReportView } = await import("@/app/(dashboard)/dashboard/attendance/ImportTab")
        return renderToStaticMarkup(h(ImportReportView, { report: r as never, onPick: () => {}, busy: false }))
    }

    it("says which column is which, each a labelled select", async () => {
        const html = await view()
        expect(html).toContain('class="ui-label">Employee number</label>')
        expect(html).toContain('<option value="0" selected="">Emp No</option>')
        expect(html).toContain('<option value="">None</option>')
    })

    it("says what importing would do, a line each, those to look at in their colour, in the page's language", async () => {
        const html = await view()
        expect(html).toContain('<ul class="ui-report" aria-label="What the file holds">')
        expect(html).toContain("<li>Rows: 15, Thu 1 Oct to Thu 15 Oct</li>")
        expect(html).toContain("<li>New punches to import: 12</li>")
        expect(html).toContain('<li data-tone="waiting">In a month whose payroll is approved, so not imported: 1</li>')
        expect(html).toContain('<li data-tone="problem">Rows that couldn&#x27;t be read: 1</li>')
        expect(html).toContain('<li data-tone="waiting">Numbers with nobody yet: 117, 118.')
        expect(html).toContain('<details class="ui-more"><summary>Show the rows that couldn&#x27;t be read</summary>')
        expect(html).not.toContain("style=")
        const arabic = await view("ar")
        expect(arabic).toContain("١٥")
        expect(arabic).toContain("117، 118")
    })

    it("asks which column is which when it can't tell", async () => {
        const html = await view("en", { ...report, columns: null })
        expect(html).toContain(`<p class="ui-card-note" role="status">${en.punch_columns_not_found.replace("'", "&#x27;")}</p>`)
        expect(html).toContain('<option value="" selected="">Choose a column</option>')
        expect(html).not.toContain('aria-label="What the file holds"')
    })
})

describe("the files imported", () => {
    it("are rows, each with its day and what it brought in, and Withdraw, or why it was withdrawn", async () => {
        const part = card(await page(), "Imports")
        expect(part).toContain('<ul class="ui-panel ui-rows" aria-label="Imports">')
        expect(part).toContain('<span class="ui-item-title"><bdi>october.xlsx</bdi></span><span class="ui-item-detail">Thu 15 Oct: Added 12, already in 3, not imported 0</span>')
        expect(part).toContain(">Withdraw this import</button>")
        expect(part).toContain("Thu 1 Oct, withdrawn: Wrong branch")
        expect(part).toContain('<span class="ui-badge ui-badge-neutral">Withdrawn</span>')
        expect(en.punch_import_counts).not.toContain("·")
    })

    it("are counted in the page's digits on the Arabic page", async () => {
        expect(card(await page({ locale: "ar" }), ar.punch_import_history)).toContain("١٢")
    })

    it("say there are none yet, while they load, and when they didn't, with the server's word and Try again", async () => {
        expect(card(await page({ imports: { imports: [] } }), "Imports")).toContain(`<p class="ui-empty-title">${en.punch_no_imports}</p>`)
        expect(card(await page({ imports: "loading" }), "Imports")).toContain(`<p class="ui-empty-title">${en.loading}</p>`)
        const failed = card(await page({ imports: "failed" }), "Imports")
        expect(failed).toContain(`<p class="ui-empty-title">${en.punch_imports_load_failed.replace("'", "&#x27;")}</p>`)
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(">Try again</button>")
    })
})

describe("the numbers waiting for a person", () => {
    it("are a list, a table on computers and a card for each on phones, each with whose it is to pick and Save", async () => {
        const html = await page({ tab: "numbers" })
        expect(html).toContain('<h2 class="ui-section-title">Numbers with nobody yet</h2>')
        expect(html).toContain('<caption class="ui-visually-hidden">Numbers with nobody yet</caption>')
        expect(html).toContain('<div class="ui-item-title"><bdi>117</bdi></div><div class="ui-item-detail">Punches: 2, Fri 16 Oct to Fri 16 Oct</div>')
        expect(html).toContain('aria-label="Who number 117 is"')
        expect(html).toMatch(/<button type="button" class="ui-btn ui-btn-primary ui-btn-sm" disabled="">Save<\/button>/)
        expect(html).toContain('<ul class="ui-cards" aria-label="Numbers with nobody yet">')
    })

    it("offer nobody one's own number to save", async () => {
        const html = await page({ tab: "numbers" })
        expect(html).toContain('<option value="u2">Sami Nabil</option>')
        expect(html).not.toContain('<option value="u1">Hana Saad</option>')
    })

    it("say when every number has a person", async () => {
        expect(await page({ tab: "numbers", codes: { ...CODES, unmatched: [] } })).toContain(`<p class="ui-empty-title">${en.punch_numbers_none_waiting}</p>`)
    })
})

describe("the numbers saved", () => {
    it("are a card: a number saved by hand in a form, then a row each, with Remove on anybody else's", async () => {
        const part = card(await page({ tab: "numbers" }), "Numbers and people")
        expect(part).toContain('<form class="ui-field-row" noValidate="">')
        expect(part).toContain('class="ui-label">Employee number</label>')
        expect(part).toMatch(/<button type="submit" class="ui-btn ui-btn-secondary" disabled="">Save<\/button>/)
        expect(part).toContain('<span class="ui-item-title"><bdi>101</bdi></span><span class="ui-item-detail">Sami Nabil</span>')
        expect(part.match(/>Remove<\/button>/g)).toHaveLength(1)
    })

    it("say while they load, and when they didn't, with the server's word and Try again", async () => {
        expect(await page({ tab: "numbers", codes: "loading" })).toContain(`<p class="ui-empty-title">${en.loading}</p>`)
        const failed = await page({ tab: "numbers", codes: "failed" })
        expect(failed).toContain(`<p class="ui-empty-title">${en.punch_numbers_load_failed.replace("'", "&#x27;")}</p>`)
        expect(failed).toContain(">Try again</button>")
    })
})

describe("Import and Employee numbers are on the building blocks", () => {
    const IMPORT = readFileSync("app/(dashboard)/dashboard/attendance/ImportTab.tsx", "utf8")
    const NUMBERS = readFileSync("app/(dashboard)/dashboard/attendance/NumbersTab.tsx", "utf8")
    const PAGE = readFileSync("app/(dashboard)/dashboard/attendance/page.tsx", "utf8")

    it("are files of their own, with no hand-made styles, old buttons, spinner or old modal left", () => {
        for (const source of [IMPORT, NUMBERS]) {
            expect(source).not.toContain("style={")
            expect(source).not.toMatch(/className=\{?['"`](btn|input|label|glass)/)
            expect(source).not.toContain("LoadingSpinner")
            expect(source).not.toContain("ConfirmModal")
        }
        expect(PAGE).toContain("import ImportTab from './ImportTab'")
        expect(PAGE).toContain("import NumbersTab from './NumbersTab'")
        expect(PAGE).not.toContain("function ImportTab(")
        expect(PAGE).not.toContain("function NumbersTab(")
    })

    it("withdraw a file in the building blocks' dialog, asking why, under its field when it's missing", () => {
        expect(IMPORT).toMatch(/<Dialog\s+open=\{withdrawing !== null\}/)
        expect(IMPORT).toContain("t('punch_reason_required')")
        expect(IMPORT).toMatch(/<Button variant="danger"[\s\S]*?>\s*\{t\('punch_withdraw_import'\)\}\s*<\/Button>/)
    })

    it("remove a number in the building blocks' dialog, its confirm the danger button", () => {
        expect(NUMBERS).toMatch(/<Dialog\s+open=\{removing !== null\}/)
        expect(NUMBERS).toMatch(/<Button variant="danger"[\s\S]*?>\s*\{t\('punch_number_remove'\)\}\s*<\/Button>/)
    })
})
