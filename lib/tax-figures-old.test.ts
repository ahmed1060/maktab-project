import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { countOf } from "./plural"
import { figuresAge, TAX_OLD_AFTER_DAYS, type TaxPosition } from "./tax-claims"

/**
 * Figures getting old (CLIENT_PORTAL_PLAN.md §4.3, §12 step 5; DESIGN.md
 * §5.5, A client's tax position, for the company's people; PR 321): from 30
 * days after the day a client's figures are from, its Tax position and its
 * row in the Clients list say how long it's been. That each company's
 * clients are counted to that company's own today is in
 * lib/tax-claims.db.test.ts. The companies and claims here are made up.
 */

const state = {
    locale: "en",
    data: undefined as TaxPosition | undefined,
    grants: new Set(["clients.view", "clients.manage"]),
    list: [] as unknown[],
}
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: "ADMIN" } }, status: "authenticated" }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (p: string) => state.grants.has(p) }), useViewer: () => ({ id: "u1", role: "ADMIN" }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => "Clients", icon: () => "🚚" }) }))
// The section asks by [address, client]; the list by its address.
vi.mock("swr", () => ({
    default: (key: string | [string, string] | null) => {
        const still = { error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
        if (Array.isArray(key)) return { ...still, data: state.data === undefined ? undefined : { scope: key[1], url: key[0], body: { data: state.data } } }
        return { ...still, data: key ? { data: state.list } : undefined }
    },
}))

let Section: (props: { clientId: string; manages?: boolean }) => ReactElement
let ClientsPage: () => ReactElement
beforeAll(async () => {
    Section = (await import("@/components/tax/TaxPosition")).default
    ClientsPage = (await import("@/app/(dashboard)/dashboard/clients/page")).default
}, 60_000)
beforeEach(() => {
    state.locale = "en"
    state.data = undefined
    state.grants = new Set(["clients.view", "clients.manage"])
    state.list = []
})

describe("how old a client's figures are (§4.3)", () => {
    it("says nothing for 29 days, and how many from 30", () => {
        expect(TAX_OLD_AFTER_DAYS).toBe(30)
        expect(figuresAge("2026-10-19", "2026-11-17")).toBeNull()
        expect(figuresAge("2026-10-19", "2026-11-18")).toBe(30)
        expect(figuresAge("2026-10-14", "2026-11-17")).toBe(34)
        expect(figuresAge("2025-11-17", "2026-11-17")).toBe(365)
    })

    it("says nothing on the day itself, or for a day yet to come", () => {
        expect(figuresAge("2026-11-17", "2026-11-17")).toBeNull()
        expect(figuresAge("2026-11-18", "2026-11-17")).toBeNull()
    })

    it("counts calendar days, across months of any length and a leap day", () => {
        expect(figuresAge("2026-01-31", "2026-03-01")).toBeNull()
        expect(figuresAge("2026-01-31", "2026-03-02")).toBe(30)
        expect(figuresAge("2028-01-31", "2028-03-01")).toBe(30)
    })
})

const POSITION: TaxPosition = {
    client: { id: "noor", name: "Al Noor", archived: false }, today: "2026-11-18",
    position: { asOf: "2026-10-19", uploadedOn: "2026-10-20", uploadedBy: "Amal One" },
    totals: { original: 100, paid: 0, remaining: 100, open: 1, late: 0 },
    claims: [{
        id: "n1", claimNumber: "000101", item: "إقرار ضريبة الدخل", taxType: "دخل", registrationType: null, originalAmount: 100, paidAmount: 0, remainingAmount: 100,
        currency: "جنيه مصري", status: "في انتظار السداد", periodStart: "2026-01-01", periodEnd: "2026-03-31", dueDate: "2026-12-31", daysLate: 0,
    }],
    total: 1, totalPages: 1,
}
const section = (manages?: boolean) => renderToStaticMarkup(h(Section, { clientId: "noor", manages }))
/** The line under the section's title. */
const line = (html: string) => /<p class="ui-hint">(.*?)<\/p>/.exec(html)?.[1] ?? ""
const WORDS = `Figures as of 19 Oct 2026, from the portal&#x27;s file uploaded by <bdi>Amal One</bdi> on 20 Oct 2026.`
const BADGE = (days: number) => `<span class="ui-badge ui-badge-waiting">Not updated for ${days} days</span>`
const LINK = `<a class="ui-text-link ui-tax-how" href="/dashboard/tax-export">How to get the portal&#x27;s file</a>`
/** The badge on the Clients list: the same to the eye, and naming the tax position to screen readers. */
const LISTED = (days: number) => `<span class="ui-badge ui-badge-waiting"><span class="ui-visually-hidden">Tax position: </span>Not updated for ${days} days</span>`

describe("On a client's Tax position", () => {
    it("says Not updated for 30 days after the line's words, 30 days after the day the figures are from", () => {
        state.data = POSITION
        expect(line(section())).toBe(`${WORDS} ${BADGE(30)}`)
    })

    it("says nothing the day before", () => {
        state.data = { ...POSITION, today: "2026-11-17" }
        expect(line(section())).toBe(WORDS)
        expect(section()).not.toContain("ui-badge-waiting")
    })

    it("counts on as the days pass, to the company's own today", () => {
        state.data = { ...POSITION, today: "2026-12-25" }
        expect(line(section())).toBe(`${WORDS} ${BADGE(67)}`)
    })

    it("comes before How to get the portal's file, for whoever has the upload", () => {
        state.data = POSITION
        expect(line(section(true))).toBe(`${WORDS} ${BADGE(30)} ${LINK}`)
    })

    it("goes once a new file's day is the day the figures are from", () => {
        state.data = { ...POSITION, position: { asOf: "2026-11-18", uploadedOn: "2026-11-18", uploadedBy: "Amal One" } }
        expect(section(true)).not.toContain("ui-badge-waiting")
    })

    it("isn't on an archived client, whose figures stay as they were", () => {
        state.data = { ...POSITION, today: "2027-03-01", client: { ...POSITION.client, archived: true } }
        expect(section(true)).not.toContain("ui-badge-waiting")
        expect(line(section(true))).toBe(WORDS)
    })

    it("isn't there before the first file", () => {
        state.data = { ...POSITION, position: null, totals: { original: 0, paid: 0, remaining: 0, open: 0, late: 0 }, claims: [], total: 0, totalPages: 0 }
        expect(section(true)).not.toContain("ui-badge-waiting")
    })

    it("is said in Arabic, with Arabic's way of counting days", () => {
        state.locale = "ar"
        state.data = POSITION
        const days = countOf(key => ar[key], "ar", 30, "days")
        expect(days).toBe("٣٠ يومًا")
        expect(line(section())).toMatch(new RegExp(`\\. <span class="ui-badge ui-badge-waiting">لم يُحدَّث منذ ${days}</span>$`))
        // Three to ten days are counted in the plural.
        state.data = { ...POSITION, today: "2027-02-05" }
        expect(line(section())).toContain(`لم يُحدَّث منذ ${countOf(key => ar[key], "ar", 109, "days")}`)
    })
})

describe("On the Clients list", () => {
    const client = (id: string, name: string, over: Record<string, unknown> = {}) => ({
        id, name, ownerName: "Omar", mobileNumber: "0100", locationName: "Cairo", locationLink: null, locations: [], createdBy: null, archivedAt: null, inUse: false, ...over,
    })
    const list = () => renderToStaticMarkup(h(ClientsPage))
    /** A client's row in the table, and its card on a phone. */
    const row = (html: string, name: string) => new RegExp(`<tr[^>]*>(?:(?!</tr>).)*<bdi>${name}</bdi>.*?</tr>`).exec(html)?.[0] ?? ""
    const card = (html: string, name: string) => new RegExp(`<div class="ui-list-card-top">(?:(?!</div>).)*<bdi>${name}</bdi>.*?</div>`).exec(html)?.[0] ?? ""

    it("has the same badge after the client's name, where the list was given how old its figures are", () => {
        state.list = [client("noor", "Al Noor", { taxDaysOld: 34 }), client("delta", "Delta Foods")]
        const html = list()
        expect(row(html, "Al Noor")).toContain(`<bdi>Al Noor</bdi></a>${LISTED(34)}</div>`)
        expect(row(html, "Delta Foods")).not.toContain("ui-badge")
    })

    it("has it at the top of the client's card on a phone", () => {
        state.list = [client("noor", "Al Noor", { taxDaysOld: 34 }), client("delta", "Delta Foods")]
        const html = list()
        expect(card(html, "Al Noor")).toContain(`</span>${LISTED(34)}</div>`)
        expect(card(html, "Delta Foods")).not.toContain("ui-badge")
    })

    it("names the tax position to screen readers, as nothing around the badge says what wasn't updated", () => {
        state.list = [client("noor", "Al Noor", { taxDaysOld: 34 })]
        const html = list()
        expect(html.split(`<span class="ui-visually-hidden">Tax position: </span>`)).toHaveLength(3)
        // On the client's page the line it's in is the Tax position's own.
        state.data = POSITION
        expect(line(section())).not.toContain("ui-visually-hidden")
    })

    it("shows what it's given, and counts nothing itself: the server counts each company's clients to that company's today", () => {
        const page = readFileSync("app/(dashboard)/dashboard/clients/page.tsx", "utf8")
        expect(page).toContain("taxDaysOld?: number")
        expect(page).not.toContain("figuresAge")
        expect(page).not.toContain("TAX_OLD_AFTER_DAYS")
    })

    it("is said in Arabic", () => {
        state.locale = "ar"
        state.list = [client("noor", "Al Noor", { taxDaysOld: 34 })]
        expect(row(list(), "Al Noor")).toContain(`<span class="ui-badge ui-badge-waiting"><span class="ui-visually-hidden">الموقف الضريبي: </span>لم يُحدَّث منذ ${countOf(key => ar[key], "ar", 34, "days")}</span>`)
    })
})

describe("The clients route", () => {
    const route = readFileSync("app/api/clients/route.ts", "utf8")

    it("gives how old a client's figures are to whoever may see tax positions, in a company whose package has the client portal", () => {
        expect(route).toContain(`const seesTaxDays = can(session.user, "tax.view") && sessionHasModule(session, "TAX_POSITION")`)
        expect(route).toContain("const old = seesTaxDays ? await taxFiguresOld(clients) : new Map<string, number>()")
        // Whoever may see tax positions needn't manage clients to be told whose file is due.
        expect(route.slice(route.indexOf("const seesTaxDays"), route.indexOf("const old ="))).not.toContain("manages")
    })

    it("sends it only where there's a badge to show, and nothing else of the day the figures are from", () => {
        expect(route).toContain("...(old.has(client.id) ? { taxDaysOld: old.get(client.id) } : {}),")
        expect(route).toContain("taxPosition: { select: { clientId: true, asOf: true } },")
        // The day itself is taken off each row with the rest of its tax position.
        expect(route).toContain("clients.map(({ _count, recordSections, taxPosition, ...client }) => ({")
        expect(route).not.toContain("taxAsOf")
    })

    it("counts in the service, which leaves archived clients out and reads each company's day once", () => {
        const service = readFileSync("lib/services/tax-claim.service.ts", "utf8")
        const from = service.indexOf("export async function taxFiguresOld")
        const counted = service.slice(from, service.indexOf("\n}\n", from))
        expect(counted).toContain("figuresAge(")
        expect(counted).toContain("archivedAt")
        expect(counted).toContain("id: { in:")
        expect(counted).not.toContain("filterTimeZone(")
    })
})

describe("The words", () => {
    it("are in both languages, with the days to fill in and no command in the Arabic", () => {
        expect(en.tax_not_updated).toBe("Not updated for {days}")
        expect(ar.tax_not_updated).toBe("لم يُحدَّث منذ {days}")
    })
})
