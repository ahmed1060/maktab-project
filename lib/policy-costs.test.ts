import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { STANDARD_OFFICE, ABSENCE_MULTIPLIERS, BAND_COSTS, absenceSchema, bandSchema, dayFractionFor, policyBodySchema, type DeductionRule, type PolicyBody } from "./attendance/policy"

/**
 * What an absence and a band of lateness or early leave may cost
 * (FIRST_CHANGES_PLAN.md §1, §2; ATTENDANCE_PLAN.md §6.3, §6.5; PR 358), as
 * the product owner asked: an absence may cost 3 days, and a band 1½ or 2
 * days. All names are made up.
 */

type Loaded = { data?: unknown; error?: unknown; isLoading?: boolean; isValidating?: boolean }
const state = { locale: "en" as "en" | "ar", swr: {} as Record<string, Loaded> }

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
    usePathname: () => "/dashboard/settings",
    useSearchParams: () => new URLSearchParams("tab=attendance"),
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "me", role: "ADMIN" } } }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, isRtl: state.locale === "ar", t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("swr", () => {
    const useSWR = (key: string | null) => {
        const shown = key ? state.swr[key] : undefined
        return { data: undefined, error: undefined, isLoading: !!key && !shown, isValidating: false, mutate: async () => {}, ...shown }
    }
    return { default: useSWR, useSWRConfig: () => ({ mutate: async () => {} }) }
})

const BANDS: DeductionRule = {
    ...STANDARD_OFFICE.lateness,
    bands: [
        { fromMinutes: 16, toMinutes: 30, dayFraction: 0.25 },
        { fromMinutes: 31, toMinutes: 60, dayFraction: 1.5 },
        { fromMinutes: 61, toMinutes: null, dayFraction: 2 },
    ],
    freePerMonth: 0,
    monthlyCapDays: null,
}
const COSTLY: PolicyBody = { ...STANDARD_OFFICE, lateness: BANDS, absence: { multiplier: 3 } }

describe("what the policy's rules take", () => {
    it("offers a band ¼ to 2 days, and an absence nothing to 3 days, in order", () => {
        expect([...BAND_COSTS]).toEqual([0.25, 0.5, 0.75, 1, 1.5, 2])
        expect([...ABSENCE_MULTIPLIERS]).toEqual([0, 1, 1.5, 2, 3])
    })

    it("takes a band of up to 2 days and an absence of up to 3, and no more", () => {
        for (const cost of BAND_COSTS) expect(bandSchema.safeParse({ fromMinutes: 16, toMinutes: 30, dayFraction: cost }).success, String(cost)).toBe(true)
        expect(bandSchema.safeParse({ fromMinutes: 16, toMinutes: 30, dayFraction: 2.25 }).success).toBe(false)
        expect(bandSchema.safeParse({ fromMinutes: 16, toMinutes: 30, dayFraction: 0 }).success).toBe(false)
        for (const m of ABSENCE_MULTIPLIERS) expect(absenceSchema.safeParse({ multiplier: m }).success, String(m)).toBe(true)
        expect(absenceSchema.safeParse({ multiplier: 3.5 }).success).toBe(false)
        // The whole policy, as the server checks it on saving.
        expect(policyBodySchema.safeParse(COSTLY).success).toBe(true)
    })

    it("charges a band of 1½ or 2 days in full", () => {
        expect(dayFractionFor(BANDS, 45, 480)).toBe(1.5)
        expect(dayFractionFor(BANDS, 90, 480)).toBe(2)
        expect(dayFractionFor(BANDS, 20, 480)).toBe(0.25)
    })
})

async function dialog(start: PolicyBody, locale: "en" | "ar" = "en") {
    Object.assign(state, { locale, swr: {} })
    const { default: PolicyDialog } = await import("@/components/attendance-policy/PolicyDialog")
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(PolicyDialog, {
            title: en.attendance_change_policy, start, companyId: "c1", defaultFrom: "2026-12-01", today: "2026-11-02",
            startOn: () => start, weekdayName: (d: number) => String(d), onClose: () => {}, onSave: async () => {},
        } as never))
    } finally {
        vi.unstubAllGlobals()
    }
}

const KEY = "/api/attendance/policy?companyId=c1"
async function card(body: PolicyBody, locale: "en" | "ar" = "en") {
    const policy = { versions: [{ id: "p1", effectiveFrom: "2026-01-01", body, appliedTemplateId: null }], templates: [], today: "2026-11-02", canEdit: true }
    Object.assign(state, { locale, swr: { [KEY]: { data: { data: policy } } } })
    const { default: Panel } = await import("@/components/AttendancePolicyPanel")
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(Panel, { companyId: "c1", readOnly: false, onChanged: () => {} }))
    } finally {
        vi.unstubAllGlobals()
    }
}

/** A select's options, as value and label, by the label it's named with. */
function optionsOf(html: string, label: RegExp): [string, string][] {
    const select = html.match(new RegExp(`<select[^>]*${label.source}[^>]*>([^]*?)</select>`))
    expect(select, String(label)).not.toBeNull()
    return [...select![1].matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map(m => [m[1], m[2]])
}

describe("the dialog", () => {
    it("offers an absence of 3 days, in both languages", async () => {
        const en1 = await dialog(STANDARD_OFFICE)
        const id = en1.match(new RegExp(`<label for="([^"]+)" class="ui-label">${en.attendance_absence_label}</label>`))![1]
        expect(optionsOf(en1, new RegExp(`id="${id}"`))).toEqual([["0", "Nothing"], ["1", "1 day"], ["1.5", "1.5 days"], ["2", "2 days"], ["3", "3 days"]])
        const ar1 = await dialog(STANDARD_OFFICE, "ar")
        const arId = ar1.match(new RegExp(`<label for="([^"]+)" class="ui-label">${ar.attendance_absence_label}</label>`))![1]
        expect(optionsOf(ar1, new RegExp(`id="${arId}"`)).at(-1)).toEqual(["3", "٣ أيام"])
    })

    it("keeps 3 days picked when the policy has it", async () => {
        const html = await dialog(COSTLY)
        expect(html).toContain(`<option value="3" selected="">3 days</option>`)
    })

    it("offers a band 1½ and 2 days after 1 day, named as the other costs are, in both languages", async () => {
        const cost = (n: number) => new RegExp(`aria-label="${en.attendance_band_cost_label.replace("{n}", String(n))}"`)
        expect(optionsOf(await dialog(STANDARD_OFFICE), cost(16))).toEqual([
            ["0.25", en.attendance_day_quarter], ["0.5", en.attendance_day_half], ["0.75", en.attendance_day_three_quarters],
            ["1", en.attendance_day_1], ["1.5", "1½ days"], ["2", "2 days"],
        ])
        const arCost = (n: string) => new RegExp(`aria-label="${ar.attendance_band_cost_label.replace("{n}", n)}"`)
        expect(optionsOf(await dialog(STANDARD_OFFICE, "ar"), arCost("١٦")).slice(-2)).toEqual([["1.5", "يوم ونصف"], ["2", "يومان"]])
    })

    it("keeps a band's 2 days picked when the policy has it, without offering it twice", async () => {
        const options = optionsOf(await dialog(COSTLY), new RegExp(`aria-label="${en.attendance_band_cost_label.replace("{n}", "61")}"`))
        expect(options.filter(([v]) => v === "2")).toHaveLength(1)
        expect(await dialog(COSTLY)).toContain(`<option value="2" selected="">2 days</option>`)
    })
})

describe("the policy card", () => {
    it("says what a band of 1½ and 2 days costs, and an absence of 3 days, in both languages", async () => {
        const html = await card(COSTLY)
        expect(html).toContain(en.attendance_band_line.replace("{from}", "31").replace("{to}", "60").replace("{cost}", "1½ days"))
        expect(html).toContain(en.attendance_band_open_line.replace("{from}", "61").replace("{cost}", "2 days"))
        expect(html).toContain(en.attendance_absence_line.replace("{days}", "3 days"))
        const arabic = await card(COSTLY, "ar")
        expect(arabic).toContain(ar.attendance_band_open_line.replace("{from}", "٦١").replace("{cost}", "يومان"))
        expect(arabic).toContain(ar.attendance_band_line.replace("{from}", "٣١").replace("{to}", "٦٠").replace("{cost}", "يوم ونصف"))
    })
})

describe("its words and its one list", () => {
    it("names 1½ days in both languages, and counts 2 days as days are counted", () => {
        expect(en.attendance_day_one_and_half).toBe("1½ days")
        expect(ar.attendance_day_one_and_half).toBe("يوم ونصف")
        expect(en.count_days_two).toBe("2 days")
        expect(ar.count_days_two).toBe("يومان")
    })

    it("lists the costs once, beside the rules that check them, and names them once for the dialog and the card", () => {
        const fields = readFileSync("components/attendance-policy/RuleFields.tsx", "utf8")
        expect(fields).toContain("BAND_COSTS")
        expect(fields).not.toMatch(/const FRACTIONS = \[/)
        const dialogSource = readFileSync("components/attendance-policy/PolicyDialog.tsx", "utf8")
        expect(dialogSource).toContain("ABSENCE_MULTIPLIERS")
        expect(dialogSource).not.toMatch(/const ABSENCE_MULTIPLIERS = \[/)
        for (const file of ["components/attendance-policy/PolicyDialog.tsx", "components/AttendancePolicyPanel.tsx"]) {
            const source = readFileSync(file, "utf8")
            expect(source, file).toContain("dayCost(")
            expect(source, file).not.toContain("attendance_day_three_quarters")
        }
        // The rules' limits follow the lists.
        const policy = readFileSync("lib/attendance/policy.ts", "utf8")
        expect(policy).toMatch(/dayFraction: z\.number\(\)\.gt\(0\)\.max\(Math\.max\(\.\.\.BAND_COSTS\)\)/)
        expect(policy).toMatch(/multiplier: z\.number\(\)\.min\(0\)\.max\(Math\.max\(\.\.\.ABSENCE_MULTIPLIERS\)\)/)
    })

    it("says so in the attendance plan", () => {
        const plan = readFileSync("ATTENDANCE_PLAN.md", "utf8")
        const absence = plan.slice(plan.indexOf("### 6.5 Absence"), plan.indexOf("### 6.6"))
        expect(absence).toContain("(1, 1.5, 2, 3)")
        expect(plan).toContain("A band costs ¼, ½, ¾ or 1 day, or 1½ or 2 days (#358)")
    })
})
