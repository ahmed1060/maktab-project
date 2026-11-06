import { beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The date fields' last part (DESIGN.md §5.3, PR 210): the dates the
 * browser's own date field still took, the day an acting role ends, a
 * contract's last working day and the day a cash advance changed hands,
 * open the calendar every other date opens, and say the day in the page's
 * language and digits. A date can't be half typed on it, so the words for
 * one that was are gone.
 */

const state = { locale: "en" as "en" | "ar" }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("swr", () => ({ default: () => ({ data: undefined, error: undefined, isValidating: false, mutate: async () => {} }) }))
beforeEach(() => { state.locale = "en" })

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const read = (path: string) => readFileSync(path, "utf8")

/** Every component under a folder. */
function sources(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name)
        return statSync(path).isDirectory() ? sources(path) : path.endsWith(".tsx") ? [path] : []
    })
}

/** A field by its label, up to its end: its control, and its hint or its error. */
function field(html: string, label: string): string {
    const at = html.indexOf(`>${esc(label)}</label>`)
    expect(at, `no field labelled ${label}`).toBeGreaterThan(-1)
    const start = html.lastIndexOf('<div class="ui-field">', at)
    return html.slice(start, html.indexOf("</div>", at) + 6)
}
const button = (chunk: string) => chunk.match(/<button[^>]*>/)?.[0] ?? ""

async function advanceDialog() {
    const { default: CashAdvanceDialog } = await import("@/components/cash-advances/CashAdvanceDialog")
    // Its portal is a stand-in's here, which still asks where it goes.
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(CashAdvanceDialog, {
            person: { id: "u1", name: "Mona Ali", balance: 500 }, kind: "RETURNED", today: "2026-11-05", onClose: () => {}, onSaved: () => {},
        } as never))
    } finally {
        vi.unstubAllGlobals()
    }
}

describe("a date, wherever it's picked", () => {
    it("is never the browser's own date field, but the calendar", () => {
        const own = [...sources("app"), ...sources("components")].filter(path => /type=(?:"|\{["'])(?:date|datetime-local)["']/.test(read(path)))
        expect(own).toEqual([])
    })

    // The profile form puts the focus on its first field wrong by its name.
    it("names its button for a form that finds a field by its name, which sends nothing with the form", async () => {
        const { default: DatePickerSingle } = await import("@/components/DatePickerSingle")
        const html = renderToStaticMarkup(h(DatePickerSingle, { name: "lastWorkingDay", label: "Last working day", value: "", onChange: () => {} }))
        expect(button(html)).toContain('name="lastWorkingDay"')
        expect(button(html)).toContain('type="button"')
        expect(button(renderToStaticMarkup(h(DatePickerSingle, { label: "Date", value: "", onChange: () => {} })))).not.toContain("name=")
    })

    it("is shown in the building blocks' own page as the calendar", () => {
        expect(read("app/(dashboard)/dashboard/ui-kit/page.tsx")).toContain("<DatePickerSingle label={s.deadline} value={deadline} onChange={setDeadline} />")
    })
})

describe("the day a cash advance changed hands", () => {
    it("is picked on the calendar, today to start from, and no day after it", async () => {
        const day = field(await advanceDialog(), en.advances_date)
        expect(day).not.toContain("<input")
        expect(button(day)).toContain('aria-haspopup="dialog"')
        expect(button(day)).toContain('name="date"')
        // Today in the company's calendar, in the page's language.
        expect(day).toContain(">5 Nov 2026</button>")
        // A day after today can't be picked; one that is after it, as the
        // company's today moves while it's open, is still said under it.
        expect(read("components/cash-advances/CashAdvanceDialog.tsx"))
            .toContain(`<DatePickerSingle name="date" label={t('advances_date')} value={date} maxDate={today} error={dateError} onChange={setDate} />`)
    })

    it("is said in Arabic digits in Arabic", async () => {
        state.locale = "ar"
        expect(field(await advanceDialog(), ar.advances_date)).toContain(">٥ نوفمبر ٢٠٢٦</button>")
    })
})

describe("a person's profile", () => {
    it("asks only its number fields what the browser couldn't read, as its date is the calendar's", () => {
        expect(read("components/EmployeeProfileForm.tsx")).toContain("const unreadable = (['salary', 'dayOffCredit'] as const).filter(name => {")
        expect(read("lib/profile-form.ts")).toContain("unreadable?: readonly ('salary' | 'dayOffCredit')[]")
        for (const path of ["components/profile/RoleRequestDialog.tsx", "components/profile/EndContractDialog.tsx"]) {
            expect(read(path), path).not.toContain("badInput")
            expect(read(path), path).not.toContain("namedItem(")
        }
    })
})

describe("its words", () => {
    it("no longer ask for a date typed in full, as none can be half typed on the calendar", () => {
        for (const key of ["profile_acting_incomplete", "end_contract_date_incomplete"]) {
            expect(en, key).not.toHaveProperty(key)
            expect(ar, key).not.toHaveProperty(key)
        }
    })

    it("ask for a cash advance's day without a command in the masculine", () => {
        expect(ar.advances_date_invalid).toBe("يُرجى اختيار يوم تسليم المال أو ردّه: اليوم أو قبله.")
        expect(en.advances_date_invalid).toBe("Pick the day the money changed hands: today or before.")
    })
})
