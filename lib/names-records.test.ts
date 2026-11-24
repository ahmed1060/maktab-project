import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"

/**
 * Records and a client's page with each client and person in the page's
 * language (LATER_CHANGES_PLAN.md §3.1, step 8e; PR 416): the records list
 * and a record's details, Add record's client picker in the page's order,
 * the records search by a client's Arabic name, and a client's own page.
 * Each name is in the page's language, or in the one it has while it has
 * only one.
 */

const state = {
    locale: "en" as "en" | "ar",
    grants: "all" as "all" | string[],
    keys: [] as string[],
    swr: {} as Record<string, unknown>,
    chargesClient: undefined as unknown,
}
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
    useSearchParams: () => new URLSearchParams(""),
    useParams: () => ({ id: "k1" }),
    usePathname: () => "/dashboard/records",
}))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: (key: string) => key }) }))
vi.mock("@/lib/useCan", () => ({
    useCan: () => ({ can: (p: string) => state.grants === "all" || state.grants.includes(p), companyWide: () => true, scope: () => "COMPANY" }),
    useViewer: () => ({ id: "admin", role: "ADMIN" }),
}))
vi.mock("@/lib/features/useFeatures", () => ({ useFeatures: () => ({ has: () => false }) }))
// Drawn in place: the real one waits to be mounted in a browser.
vi.mock("@/components/ui/Dialog", async importOriginal => ({
    ...await importOriginal<typeof import("@/components/ui/Dialog")>(),
    Dialog: ({ open, title, children, actions }: any) => open === false ? null : h("div", null, h("h2", null, title), children, actions),
    DialogActions: ({ children }: any) => h("div", null, children),
}))
// What the client's page hands its charges: the client's name, for Mark collected's wording.
vi.mock("@/components/charges/ChargesList", () => ({ default: ({ client }: { client: unknown }) => { state.chargesClient = client; return null } }))
// Each request answered by the start of its address; a list's key is [address, company].
vi.mock("swr", () => ({
    default: (key: string | [string, string] | null) => {
        if (!key) return { data: undefined, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
        const url = Array.isArray(key) ? key[0] : key
        state.keys.push(url)
        const found = Object.entries(state.swr).find(([start]) => url.startsWith(start))?.[1]
        const data = found === undefined ? undefined : Array.isArray(key) ? { scope: key[1], url, body: found } : found
        return { data, error: undefined, isLoading: found === undefined, isValidating: false, mutate: async () => {} }
    },
    useSWRConfig: () => ({ mutate: () => {} }),
}))

// Made-up people and clients, and the record service's database, with what it's asked kept.
const { HANA, OMAR, NOOR, asked, db } = vi.hoisted(() => {
    const HANA = { firstName: "Hana", lastName: "Saad", firstNameAr: "هناء", lastNameAr: "سعد" }
    const OMAR = { firstName: "Omar", lastName: "Adel", firstNameAr: "عمر", lastNameAr: "عادل" }
    const NOOR = { id: "k1", name: "Al Noor Trading", nameAr: "النور للتجارة" }
    const ROW = {
        id: "r1", content: "Trade licence", attachment: null, expiryDate: null, reminderDays: null,
        createdAt: new Date("2026-11-01T09:00:00Z"), lastEditedAt: new Date("2026-11-20T09:00:00Z"),
        createdBy: HANA, lastEditedBy: OMAR, createdBySuperAdmin: false, lastEditedBySuperAdmin: false,
        section: { id: "s1", title: "Licences", client: NOOR },
    }
    const asked: Record<string, any> = {}
    const db = {
        company: { findUnique: async () => ({ timezone: "Africa/Cairo" }) },
        clientRecord: {
            findMany: async (query: unknown) => { asked.records = query; return [ROW] },
            count: async () => 1,
        },
        client: {
            findMany: async (query: unknown) => { asked.clients = query; return [NOOR] },
            findUnique: async (query: unknown) => { asked.client = query; return { ...NOOR, companyId: "c1", archivedAt: null } },
        },
        recordSection: { findMany: async () => [] },
    }
    return { HANA, OMAR, NOOR, ROW, asked, db }
})
vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("@/lib/storage", () => ({ supabase: {} }))

const { RecordService } = await import("@/lib/services/record.service")
const read = (path: string) => stripComments(readFileSync(path, "utf8"))
const render = (el: ReturnType<typeof h>, locale: "en" | "ar") => { state.locale = locale; return renderToStaticMarkup(el) }
const times = (html: string, text: string) => html.split(text).length - 1

const RECORD = {
    id: "r1", content: "Trade licence", files: [], expiryDate: null, expiry: null, reminderDays: null,
    createdAt: "2026-11-01T09:00:00Z", lastEditedAt: "2026-11-20T09:00:00Z",
    createdBy: HANA, lastEditedBy: OMAR, createdBySuperAdmin: false, lastEditedBySuperAdmin: false,
    section: { id: "s1", title: "Licences" }, client: NOOR,
}
const SUPER_ADMIN = { user: { id: "sa", role: "SUPER_ADMIN" } }

beforeEach(() => {
    state.grants = "all"
    state.keys = []
    state.swr = {}
    state.chargesClient = undefined
    for (const key of Object.keys(asked)) delete asked[key]
})

describe("the records list", () => {
    const list = async (locale: "en" | "ar") => {
        state.swr = { "/api/records?": { data: { data: [RECORD], total: 1, totalPages: 1 } } }
        const { default: RecordsList } = await import("@/components/records/RecordsList")
        return render(h(RecordsList, {}), locale)
    }

    it("names each record's client in the page's language, in its table row and its card", async () => {
        expect(times(await list("ar"), "<bdi>النور للتجارة</bdi>")).toBe(2)
        expect(times(await list("en"), "<bdi>Al Noor Trading</bdi>")).toBe(2)
    })

    it("and who added it", async () => {
        expect(times(await list("ar"), "هناء سعد")).toBe(2)
        expect(times(await list("en"), "Hana Saad")).toBe(2)
    })

    it("a client with no Arabic name, in English on an Arabic page", async () => {
        state.locale = "ar"
        state.swr = { "/api/records?": { data: { data: [{ ...RECORD, client: { id: "k2", name: "Beta Supplies", nameAr: null } }], total: 1, totalPages: 1 } } }
        const { default: RecordsList } = await import("@/components/records/RecordsList")
        expect(times(renderToStaticMarkup(h(RecordsList, {})), "<bdi>Beta Supplies</bdi>")).toBe(2)
    })
})

describe("a record's details", () => {
    const dialog = async (locale: "en" | "ar", record: object = RECORD) => {
        const { default: RecordDialog } = await import("@/components/records/RecordDialog")
        return render(h(RecordDialog, { record: record as any, onClose: () => {}, showClient: true }), locale)
    }

    it("name its client, who added it and who last edited it in the page's language", async () => {
        const html = await dialog("ar")
        expect(html).toContain("<bdi>النور للتجارة</bdi>")
        expect(html).toContain("هناء سعد")
        expect(html).toContain("عمر عادل")
        const english = await dialog("en")
        expect(english).toContain("<bdi>Al Noor Trading</bdi>")
        expect(english).toContain("Hana Saad")
        expect(english).toContain("Omar Adel")
    })

    it("say a Super Admin, or a user since deleted, as before", async () => {
        const html = await dialog("ar", { ...RECORD, createdBy: null, createdBySuperAdmin: true, lastEditedBy: null })
        expect(html).toContain(ar.role_super_admin)
        expect(html).toContain(ar.records_deleted_user)
    })
})

describe("Add record's client picker, on the Records page", () => {
    const BETA = { id: "k2", name: "Beta Supplies", nameAr: null }
    const ADAM = { id: "k3", name: "Adam Foods", nameAr: "آدم للأغذية" }
    const form = async (locale: "en" | "ar") => {
        // As the server gives them for that language: an Arabic page's by their Arabic.
        state.swr = { "/api/records/clients": { data: { clients: locale === "ar" ? [NOOR, ADAM, BETA] : [ADAM, NOOR, BETA], more: false } } }
        const { default: RecordForm } = await import("@/components/records/RecordForm")
        return render(h(RecordForm, { open: true, onClose: () => {}, record: null, onSaved: () => {} }), locale)
    }
    const options = (html: string) => (html.match(/<option value="k\d"[^>]*>[^<]*<\/option>/g) ?? []).map(o => o.replace(/<[^>]*>/g, ""))

    it("lists each client in the page's language, in the page's order", async () => {
        expect(options(await form("ar"))).toEqual(["آدم للأغذية", "النور للتجارة", "Beta Supplies"])
        expect(options(await form("en"))).toEqual(["Adam Foods", "Al Noor Trading", "Beta Supplies"])
    })

    it("chooses the first it lists", async () => {
        expect(await form("ar")).toMatch(/<option value="k3" selected="">/)
        expect(await form("en")).toMatch(/<option value="k3" selected="">/)
    })

    it("asks for them in the page's language", async () => {
        await form("ar")
        expect(state.keys.find(k => k.startsWith("/api/records/clients"))).toContain("locale=ar")
        state.keys = []
        await form("en")
        expect(state.keys.find(k => k.startsWith("/api/records/clients"))).toContain("locale=en")
        expect(read("app/api/records/clients/route.ts")).toContain('RecordService.clients(session, params.get("companyId"), params.get("search")?.slice(0, 100), params.get("locale"))')
    })
})

describe("the record service", () => {
    it("finds a record by its client's Arabic name too", async () => {
        await RecordService.list(SUPER_ADMIN, { companyId: "c1", search: "النور", page: 1, limit: 20 })
        expect(asked.records.where.OR).toContainEqual({ section: { client: { nameAr: { contains: "النور", mode: "insensitive" } } } })
        expect(asked.records.where.OR).toContainEqual({ section: { client: { name: { contains: "النور", mode: "insensitive" } } } })
    })

    it("gives each record's client and who added and edited it with their Arabic", async () => {
        const { data } = await RecordService.list(SUPER_ADMIN, { companyId: "c1", page: 1, limit: 20 })
        expect(data[0].client).toEqual(NOOR)
        expect(data[0].createdBy).toEqual(HANA)
        expect(data[0].lastEditedBy).toEqual(OMAR)
        const select = asked.records.select
        expect(select.createdBy).toEqual({ select: { firstName: true, lastName: true, firstNameAr: true, lastNameAr: true } })
        expect(select.lastEditedBy).toEqual({ select: { firstName: true, lastName: true, firstNameAr: true, lastNameAr: true } })
        expect(select.section.select.client.select).toMatchObject({ id: true, name: true, nameAr: true })
    })

    it("lists Add record's clients with their Arabic, found by either language", async () => {
        const { clients } = await RecordService.clients(SUPER_ADMIN, "c1", "نور", "en")
        expect(clients[0]).toEqual(NOOR)
        expect(asked.clients.where.OR).toEqual([
            { name: { contains: "نور", mode: "insensitive" } },
            { nameAr: { contains: "نور", mode: "insensitive" } },
        ])
        expect(asked.clients.select).toMatchObject({ id: true, name: true, nameAr: true })
    })

    it("the first an Arabic page lists by their Arabic, those with none last; an English page's by their English", async () => {
        await RecordService.clients(SUPER_ADMIN, "c1", null, "ar")
        expect(asked.clients.orderBy).toEqual([{ nameAr: { sort: "asc", nulls: "last" } }, { name: "asc" }, { id: "asc" }])
        await RecordService.clients(SUPER_ADMIN, "c1", null, "en")
        expect(asked.clients.orderBy).toEqual([{ name: "asc" }, { id: "asc" }])
        await RecordService.clients(SUPER_ADMIN, "c1", null, null)
        expect(asked.clients.orderBy).toEqual([{ name: "asc" }, { id: "asc" }])
    })

    it("gives a client's page its name in Arabic too", async () => {
        const { client } = await RecordService.sectionsOf(SUPER_ADMIN, "k1")
        expect(client).toEqual({ ...NOOR, archived: false })
        expect(asked.client.select).toMatchObject({ id: true, name: true, nameAr: true })
    })

    it("and its charges, to whoever sees nothing else of it", async () => {
        const { chargeClient } = await import("@/lib/services/charge.service")
        expect(await chargeClient({ id: "sa", role: "SUPER_ADMIN" } as any, "k1")).toEqual(NOOR)
        expect(asked.client.select).toMatchObject({ id: true, name: true, nameAr: true })
    })
})

describe("a client's own page", () => {
    const CLIENT = {
        ...NOOR, ownerName: "Ahmed Salem", ownerNameAr: "أحمد سالم", mobileNumber: "+20 100 000 0000",
        locationName: "Maadi", locationLink: null, locations: [], archivedAt: null,
    }
    const page = async (locale: "en" | "ar") => {
        const { default: ClientPage } = await import("@/app/(dashboard)/dashboard/clients/[id]/page")
        return render(h(ClientPage), locale)
    }

    it("names it and its owner in the page's language, to whoever sees its details", async () => {
        state.grants = ["clients.view"]
        state.swr = { "/api/clients?id=k1": { data: CLIENT } }
        const html = await page("ar")
        expect(html).toContain("<bdi>النور للتجارة</bdi>")
        expect(html).toContain("<bdi>أحمد سالم</bdi>")
        const english = await page("en")
        expect(english).toContain("<bdi>Al Noor Trading</bdi>")
        expect(english).toContain("<bdi>Ahmed Salem</bdi>")
    })

    it("names it in the page's language to whoever sees only its records", async () => {
        state.grants = ["records.view"]
        state.swr = { "/api/records/sections?clientId=k1": { data: { client: { ...NOOR, archived: false }, sections: [] } } }
        expect(await page("ar")).toContain("<bdi>النور للتجارة</bdi>")
        expect(await page("en")).toContain("<bdi>Al Noor Trading</bdi>")
    })

    it("and to whoever sees only its charges, whose Mark collected names it so too", async () => {
        state.grants = ["charges.view"]
        state.swr = { "/api/charges?clientId=k1": { data: { client: NOOR } } }
        expect(await page("ar")).toContain("<bdi>النور للتجارة</bdi>")
        expect(state.chargesClient).toEqual({ id: "k1", name: "النور للتجارة" })
        expect(await page("en")).toContain("<bdi>Al Noor Trading</bdi>")
        expect(state.chargesClient).toEqual({ id: "k1", name: "Al Noor Trading" })
    })
})
