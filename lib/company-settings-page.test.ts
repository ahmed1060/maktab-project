import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Company settings on the building blocks, part 1 (UI_PLAN.md §5 step 5):
 * both ways in, a company's own and the Super Admin's for any company, with
 * the page header, the tabs, loading and failing each saying so, the
 * unsaved-changes question as a dialog, and the General tab.
 */

type Loaded = { data?: unknown; error?: unknown; isLoading?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    role: "ADMIN",
    query: "",
    swr: {} as Record<string, Loaded>,
}
vi.mock("next/navigation", () => ({
    useParams: () => ({ id: "c1" }),
    useRouter: () => ({ replace: () => {}, push: () => {}, back: () => {} }),
    useSearchParams: () => new URLSearchParams(state.query),
    usePathname: () => "/dashboard/settings",
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "me", role: state.role } } }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useCan", () => ({
    useViewer: () => ({ role: state.role }),
    useCan: () => ({ can: () => true, canFor: () => true }),
}))
vi.mock("swr", () => {
    const useSWR = (key: string | null) => {
        const shown = key ? state.swr[key] : undefined
        return { data: undefined, error: undefined, isLoading: !!key && !shown, isValidating: false, mutate: async () => {}, ...shown }
    }
    return { default: useSWR, useSWRConfig: () => ({ mutate: async () => {} }) }
})

const COMPANY = {
    id: "c1", name: "Delta Sites", autoVerifyLocation: true, cashAdvancesAllowed: false, cashAdvancesOn: true, cashAdvancesHeld: 0,
    moduleLabels: null, moduleIcons: null, logoUrl: null, brandColour: null, defaultBrandColour: "#4f46e5",
    payrollDay: 25, payslipsVisible: true, timezone: "Africa/Cairo", debtRecoveryPercent: 25, package: null,
}
const OWN = { data: { data: { company: COMPANY, tabs: ["general", "branding", "payroll"], canEdit: true } } }
const refused = (status: number) => ({ error: Object.assign(new Error("Request failed"), { status, info: { error: "Database unavailable" } }) })

async function own({ swr = { "/api/company-settings": OWN } as Record<string, Loaded>, query = "", locale = "en" as "en" | "ar" } = {}) {
    Object.assign(state, { role: "ADMIN", swr, query, locale })
    const { default: Page } = await import("@/app/(dashboard)/dashboard/settings/page")
    return renderToStaticMarkup(h(Page))
}
async function superAdmin({ swr = { "/api/companies?id=c1": { data: { data: COMPANY } } } as Record<string, Loaded>, locale = "en" as "en" | "ar" } = {}) {
    Object.assign(state, { role: "SUPER_ADMIN", swr, query: "", locale })
    const { default: Page } = await import("@/app/(dashboard)/dashboard/companies/[id]/settings/page")
    return renderToStaticMarkup(h(Page))
}
async function general(props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") {
    state.locale = locale
    const { default: Card } = await import("@/components/CompanyGeneralCard")
    return renderToStaticMarkup(h(Card, { companyId: "c1", autoVerifyLocation: true, onSaved: () => {}, ...props } as never))
}

describe("a company's own settings", () => {
    it("say what they are in the page header", async () => {
        const html = await own()
        expect(html).toContain(`<h1 class="ui-page-title">${en.company_settings_title}</h1>`)
        expect(html).toContain(`<p class="ui-page-subtitle">${en.company_settings_own_hint}</p>`)
    })

    it("have the building blocks' tabs, the one open kept in the address", async () => {
        const html = await own()
        expect(html).toContain(`role="tablist" aria-label="${en.company_settings_title}"`)
        expect(html).toMatch(new RegExp(`aria-selected="true"[^>]*>${en.settings_tab_general}</button>`))
        expect(await own({ query: "tab=payroll" })).toMatch(new RegExp(`aria-selected="true"[^>]*>${en.settings_tab_payroll}</button>`))
        expect(html).toContain('role="tabpanel"')
    })

    it("say they're loading, that they didn't load, with Try again, and that they're not this person's to see", async () => {
        expect(await own({ swr: {} })).toContain('<div class="ui-panel" role="status">')
        const failed = await own({ swr: { "/api/company-settings": refused(500) } })
        expect(failed).toContain(en.settings_load_failed.replace(/'/g, "&#x27;"))
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(">Try again</button>")
        // A refusal is the answer, not a failure: there is nothing to try again.
        const denied = await own({ swr: { "/api/company-settings": refused(403) } })
        expect(denied).toContain(en.access_denied_title.replace(/'/g, "&#x27;"))
        expect(denied).not.toContain(">Try again</button>")
    })
})

describe("the Super Admin's settings for a company", () => {
    it("name the company, under a link back to Companies", async () => {
        const html = await superAdmin()
        expect(html).toContain(`class="ui-back-link" href="/dashboard/companies">`)
        expect(html).toContain(`${en.companies}</a>`)
        expect(html).toContain(`<h1 class="ui-page-title"><bdi>Delta Sites</bdi></h1>`)
        expect(html).toContain(`<p class="ui-page-subtitle">${en.company_settings_title}</p>`)
        expect(html).toContain(`role="tablist"`)
    })

    it("say they're loading, and that they didn't load, with Try again", async () => {
        expect(await superAdmin({ swr: {} })).toContain('<div class="ui-panel" role="status">')
        const failed = await superAdmin({ swr: { "/api/companies?id=c1": refused(500) } })
        expect(failed).toContain(en.settings_load_failed.replace(/'/g, "&#x27;"))
        expect(failed).toContain(">Try again</button>")
    })
})

describe("the General tab", () => {
    it("says whether submitted task locations are checked automatically, with a button to turn it off or on", async () => {
        const on = await general()
        expect(on).toContain(`<h2 class="ui-card-title">${en.settings_task_locations}</h2>`)
        expect(on).toContain(en.auto_verify_location_label)
        expect(on).toContain(en.auto_verify_location_hint.replace(/'/g, "&#x27;"))
        expect(on).toContain(`<span class="ui-badge ui-badge-good">${en.advances_on}</span>`)
        expect(on).toContain(`>${en.settings_turn_off}</button>`)
        const off = await general({ autoVerifyLocation: false })
        expect(off).toContain(`<span class="ui-badge ui-badge-neutral">${en.advances_off_badge}</span>`)
        expect(off).toContain(`>${en.settings_turn_on}</button>`)
    })

    it("shows the setting without a button to whoever can only look", async () => {
        const html = await general({ readOnly: true })
        expect(html).toContain(en.advances_on)
        expect(html).not.toContain("</button>")
    })

    it("is in the page's language", async () => {
        const html = await general({}, "ar")
        expect(html).toContain(ar.settings_task_locations)
        expect(html).toContain(ar.settings_turn_off)
    })
})

describe("found in the browser (the audit, company settings part 1)", () => {
    it("keeps a card's flush rows inset from its edges, in line with its title", () => {
        // Stretched to the card's edges and stripped of their padding, the
        // rows' text sat against the card's border (cash advances' too).
        const css = readFileSync("components/ui/ui.css", "utf8")
        // Since the Super Admin's pages part 2a the same rule covers a titled part's rows too.
        expect(css).toMatch(/\.ui-card > \.ui-rows-flush > li > \.ui-row,(\s*[^{]+)?\{\s*padding-inline: var\(--space-4\);/)
    })

    it("has no row of tabs when there's one tab to show", async () => {
        // A company that shows its people General alone had a tab row of one.
        const one = await own({ swr: { "/api/company-settings": { data: { data: { company: COMPANY, tabs: ["general"], canEdit: true } } } } })
        expect(one).not.toContain('role="tablist"')
        expect(one).not.toContain('role="tabpanel"')
        expect(one).toContain(en.settings_task_locations)
        expect(await own()).toContain('role="tablist"')
    })

    it("names the page in sentence case", () => {
        expect(en.company_settings_title).toBe("Company settings")
    })
})

describe("nothing of the old frame is left", () => {
    it("has no hand-drawn header, toggle, centred paragraphs or old confirmation", () => {
        const sa = readFileSync("app/(dashboard)/dashboard/companies/[id]/settings/page.tsx", "utf8")
        for (const old of ["style={", "className=\"glass", "onMouseOver", "<svg"]) expect(sa, old).not.toContain(old)
        const ownPage = readFileSync("app/(dashboard)/dashboard/settings/page.tsx", "utf8")
        for (const old of ["style={", "setTitle(", "useHeader"]) expect(ownPage, old).not.toContain(old)
        const tabs = readFileSync("components/CompanySettingsTabs.tsx", "utf8")
        for (const old of ["SegmentedToggle", "style={", "ConfirmModal"]) expect(tabs, old).not.toContain(old)
        const card = readFileSync("components/CompanyGeneralCard.tsx", "utf8")
        for (const old of ["style={", "className=\"glass", "|| '"]) expect(card, old).not.toContain(old)
        // The last ConfirmModal on the General tab.
        expect(readFileSync("components/cash-advances/CashAdvancesCard.tsx", "utf8")).not.toContain("ConfirmModal")
    })
})
