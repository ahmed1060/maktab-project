import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"

/**
 * The pickers and filters the screens share, with each person and client in
 * the page's language (LATER_CHANGES_PLAN.md §3.1, step 8a; PR 412): the
 * people a task or an obligation is for, the lists' employee filter, their
 * client and place filters, and the client pickers. Each name is in the
 * page's language, or in the one it has while it has only one; a person is
 * found by either language; and a list to pick from is in the page's order,
 * the ones with an Arabic name first on an Arabic page, in Arabic order.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    viewer: { id: "a1", role: "ADMIN" } as Record<string, unknown>,
    perms: new Set<string>(),
    swr: {} as Record<string, Loaded>,
    /** What Add location is told of the client it's for. */
    forTask: null as unknown,
}

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: state.viewer }, status: "authenticated" }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (k: string) => state.perms.has(k) }), useViewer: () => state.viewer }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }) }))
vi.mock("@/components/locations/LocationForm", () => ({ default: (props: { forTask?: unknown }) => { state.forTask = props.forTask; return null } }))
vi.mock("swr", () => ({
    default: (key: string | [string, string] | null) => {
        const url = Array.isArray(key) ? key[0] : key
        const loaded: Loaded = url ? state.swr[url] ?? {} : {}
        return { data: undefined, error: undefined, isValidating: false, mutate: async () => {}, ...loaded }
    },
}))

const { personMatches, peopleInOrder } = await import("@/lib/names")
const { useEmployeeOptions } = await import("@/components/filters/useEmployeeOptions")
const { usePlaceFilters } = await import("@/components/locations/usePlaceFilters")
const { useClientOptions } = await import("@/components/locations/useClientOptions")
const read = (path: string) => stripComments(readFileSync(path, "utf8"))
const render = (el: ReturnType<typeof h>, locale: "en" | "ar") => { state.locale = locale; return renderToStaticMarkup(el) }
/** Each of `texts` is in `html`, in this order. */
const inOrder = (html: string, texts: string[]) => {
    const at = texts.map(text => html.indexOf(text))
    expect(at.every(i => i >= 0), `all of ${texts.join(", ")} shown`).toBe(true)
    expect(at).toEqual([...at].sort((a, b) => a - b))
}

// Made-up people and clients.
const HANA = { id: "p1", firstName: "Hana", lastName: "Saad", firstNameAr: "هناء", lastNameAr: "سعد", role: "EMPLOYEE" }
const OMAR = { id: "p2", firstName: "Omar", lastName: "Adel", firstNameAr: "عمر", lastNameAr: "عادل", role: "TEAM_LEADER" }
const BOB = { id: "p3", firstName: "Bob", lastName: "Brown", firstNameAr: null, lastNameAr: null, role: "EMPLOYEE" }
const ADAM = { id: "p4", firstName: "Adam", lastName: "Nour", firstNameAr: "آدم", lastNameAr: "نور", role: "EMPLOYEE" }
const ZOE = { id: "p6", firstName: "Zoe", lastName: "Grant", firstNameAr: null, lastNameAr: "غرانت", role: "EMPLOYEE" }
const BOSS = { id: "p5", firstName: "Bassem", lastName: "Fahmy", firstNameAr: "باسم", lastNameAr: "فهمي", role: "ADMIN" }
const NOOR = { id: "k1", name: "Al Noor Trading", nameAr: "النور للتجارة", ownerName: "Samir Noor", ownerNameAr: "سمير نور", archivedAt: null }
const BETA = { id: "k2", name: "Beta Supplies", nameAr: null, ownerName: "Beta Owner", ownerNameAr: null, archivedAt: null }
const DELTA = { id: "k3", name: "Delta Foods", nameAr: "دلتا للأغذية", ownerName: "Dina Ali", ownerNameAr: "دينا علي", archivedAt: "2026-11-01T00:00:00Z" }

beforeEach(() => {
    state.viewer = { id: "a1", role: "ADMIN" }
    state.perms = new Set()
    state.swr = {}
})

describe("a person found and ordered by name", () => {
    it("is found by their name in either language, any case, the search trimmed", () => {
        expect(personMatches(HANA, "hana s")).toBe(true)
        expect(personMatches(HANA, "هناء سعد")).toBe(true)
        expect(personMatches(HANA, "  SAAD ")).toBe(true)
        expect(personMatches(BOB, "هناء")).toBe(false)
        expect(personMatches(BOB, "")).toBe(true)
    })

    it("an Arabic page lists the ones with an Arabic name first, in Arabic order, then the rest as they came", () => {
        expect(peopleInOrder([BOB, HANA, OMAR, ADAM], "ar").map(p => p.id)).toEqual(["p4", "p2", "p1", "p3"])
    })

    it("one with no Arabic first name isn't among those with an Arabic name, and keeps the order it came in", () => {
        expect(peopleInOrder([ZOE, HANA, BOB], "ar").map(p => p.id)).toEqual(["p1", "p6", "p3"])
    })

    it("an English page keeps the order they came in", () => {
        expect(peopleInOrder([BOB, HANA, OMAR, ADAM], "en").map(p => p.id)).toEqual(["p3", "p1", "p2", "p4"])
    })
})

describe("the people a task or an obligation is for", () => {
    it("are given with their names in Arabic", () => {
        expect(read("lib/services/assignee-guard.ts")).toContain("select: { id: true, firstName: true, lastName: true, firstNameAr: true, lastNameAr: true, role: true, ...(permission === \"tasks.create\" ? { username: true } : {}) },")
    })

    it("are each in the page's language in the checklist, or in the one they have", async () => {
        const { default: AssigneeChecklist } = await import("@/components/forms/AssigneeChecklist")
        const props = { people: [HANA, BOB], value: [], onChange: () => {}, onRetry: () => {} }
        const inArabic = render(h(AssigneeChecklist, props), "ar")
        expect(inArabic).toContain("<bdi>هناء سعد</bdi>")
        expect(inArabic).toContain("<bdi>Bob Brown</bdi>")
        expect(render(h(AssigneeChecklist, props), "en")).toContain("<bdi>Hana Saad</bdi>")
    })

    it("are found in the checklist by either language", () => {
        expect(read("components/forms/AssigneeChecklist.tsx")).toContain("const shown = (people ?? []).filter(u => personMatches(u, searchTerm))")
    })

    it("on New task and New obligation, by role first, then in the page's order", async () => {
        const { assigneesByRole } = await import("@/components/forms/AssigneeChecklist")
        expect(assigneesByRole([BOSS, OMAR, BOB, HANA, ADAM], "ar").map(p => p.id)).toEqual(["p4", "p1", "p3", "p2", "p5"])
        expect(assigneesByRole([BOSS, OMAR, BOB, HANA, ADAM], "en").map(p => p.id)).toEqual(["p4", "p3", "p1", "p2", "p5"])
        expect(read("app/(dashboard)/dashboard/tasks/new/page.tsx")).toContain("return assigneesByRole(list, locale)")
        const obligation = read("app/(dashboard)/dashboard/obligations/new/page.tsx")
        expect(obligation).toContain("const ordered = useMemo(() => assigneesByRole(users, locale), [users, locale])")
        expect(obligation).toContain("people={people === 'loading' ? undefined : people === 'failed' ? null : ordered}")
    })

    it("on a task's Transfer and an obligation's Edit, in the page's order", () => {
        expect(read("app/(dashboard)/dashboard/tasks/[id]/client.tsx")).toContain("people={transferPeople && peopleInOrder(transferPeople, locale)}")
        expect(read("app/(dashboard)/dashboard/obligations/[id]/client.tsx")).toContain("const people = loaded && peopleInOrder(loaded, locale)")
    })

    it("and Transfer names who takes on its costs in the page's language", () => {
        expect(read("components/TaskTransferModal.tsx")).toContain("return p ? personName(p, locale) : ''")
    })
})

describe("the lists' employee filter", () => {
    const options = { value: null as unknown }
    function EmployeeFilter() { options.value = useEmployeeOptions(); return null }

    it("names each person in the page's language, in the page's order", async () => {
        state.perms = new Set(["employees.view"])
        // As the server gives them, by their English.
        state.swr["/api/users?limit=1000"] = { data: { data: { data: [ADAM, BOB, HANA, OMAR, BOSS] } } }
        render(h(EmployeeFilter), "ar")
        expect(options.value).toEqual([
            { value: "", label: ar.all_employees },
            { value: "p4", label: "آدم نور" },
            { value: "p2", label: "عمر عادل" },
            { value: "p1", label: "هناء سعد" },
            { value: "p3", label: "Bob Brown" },
        ])
        render(h(EmployeeFilter), "en")
        expect(options.value).toEqual([
            { value: "", label: en.all_employees },
            { value: "p4", label: "Adam Nour" },
            { value: "p3", label: "Bob Brown" },
            { value: "p1", label: "Hana Saad" },
            { value: "p2", label: "Omar Adel" },
        ])
    })
})

describe("the client and place filters", () => {
    const filters = { value: [] as { key: string; options: unknown }[] }
    const places = [
        { id: "l1", name: "Main shop", clientId: "k1", needsPin: false, archived: false },
        { id: "l2", name: "Store", clientId: "k2", needsPin: false, archived: false },
    ]

    function PlaceFilters() { filters.value = usePlaceFilters({ clientId: "", locationId: "" }); return null }
    const run = async (locale: "en" | "ar") => {
        state.perms = new Set(["clients.view", "locations.view"])
        state.swr["/api/clients?archived=all"] = { data: { data: [BETA, NOOR, DELTA] } }
        state.swr["/api/locations?pick=filters"] = { data: { data: { locations: places } } }
        render(h(PlaceFilters), locale)
        const client = filters.value.find(f => f.key === "clientId")!.options as { value: string; label: string }[]
        const place = (filters.value.find(f => f.key === "locationId")!.options as (picked: Record<string, string>) => { value: string; label: string }[])({})
        return { client, place }
    }

    it("names each client in the page's language, in the page's order, an archived one marked", async () => {
        const { client } = await run("ar")
        expect(client.slice(2)).toEqual([
            { value: "k1", label: "النور للتجارة" },
            { value: "k3", label: `دلتا للأغذية · ${ar.clients_archived_mark}` },
            { value: "k2", label: "Beta Supplies" },
        ])
        expect((await run("en")).client.slice(2).map(o => o.label)).toEqual(["Beta Supplies", "Al Noor Trading", `Delta Foods · ${en.clients_archived_mark}`])
    })

    it("names the client beside each place in the page's language", async () => {
        expect((await run("ar")).place.map(o => o.label)).toContain("النور للتجارة - Main shop")
        expect((await run("en")).place.map(o => o.label)).toContain("Al Noor Trading - Main shop")
    })
})

describe("the client pickers", () => {
    it("of New task and a task's Edit details: each client in the page's language, in the page's order", async () => {
        const { default: TaskPlacePicker } = await import("@/components/locations/TaskPlacePicker")
        state.perms = new Set(["clients.view"])
        state.swr["/api/clients"] = { data: { data: [BETA, NOOR] } }
        const props = { value: { clientId: "", locationId: "" }, onChange: () => {}, currentClient: { id: "k3", name: DELTA.name, nameAr: DELTA.nameAr } }
        const html = render(h(TaskPlacePicker, props), "ar")
        inOrder(html, [">النور للتجارة</option>", ">Beta Supplies</option>", `>دلتا للأغذية · ${ar.clients_archived_mark}</option>`])
        inOrder(render(h(TaskPlacePicker, props), "en"), [">Beta Supplies</option>", ">Al Noor Trading</option>", `>Delta Foods · ${en.clients_archived_mark}</option>`])
    })

    it("which names the client picked in the page's language, over its locations and to New location", async () => {
        const { default: TaskPlacePicker } = await import("@/components/locations/TaskPlacePicker")
        state.perms = new Set(["clients.view", "locations.view"])
        state.swr["/api/clients"] = { data: { data: [BETA, NOOR] } }
        const url = "/api/locations?pick=1&clientId=k1"
        state.swr[url] = { data: { scope: "k1", url, body: { data: { client: [{ id: "l1", name: "Main shop", isHq: true, needsPin: false }], shared: [] } } } }
        const props = { value: { clientId: "k1", locationId: "" }, onChange: () => {} }
        expect(render(h(TaskPlacePicker, props), "ar")).toContain(`label="${ar.task_location_client_group.replace("{name}", "النور للتجارة")}"`)
        expect(state.forTask).toMatchObject({ clientName: "النور للتجارة" })
        expect(render(h(TaskPlacePicker, props), "en")).toContain(`label="${en.task_location_client_group.replace("{name}", "Al Noor Trading").replace("'", "&#x27;")}"`)
        expect(state.forTask).toMatchObject({ clientName: "Al Noor Trading" })
    })

    it("which is given an edited task's client's Arabic", () => {
        expect(read("components/TaskEditDetailsModal.tsx")).toContain("currentClient={task.client && task.clientId ? { id: task.clientId, name: task.client.name, nameAr: task.client.nameAr } : null}")
        expect(read("app/(dashboard)/dashboard/tasks/[id]/page.tsx")).toContain("client: { select: { name: true, nameAr: true } },")
    })

    it("of the places and charges: each client in the page's language, in the page's order", async () => {
        state.swr["/api/clients"] = { data: { scope: "", url: "/api/clients", body: { data: [BETA, NOOR, DELTA] } } }
        const got = { value: [] as { id: string; name: string }[] }
        function ClientOptions() { got.value = useClientOptions(true).clients; return null }
        render(h(ClientOptions), "ar")
        expect(got.value.map(c => [c.id, c.name])).toEqual([["k1", "النور للتجارة"], ["k3", "دلتا للأغذية"], ["k2", "Beta Supplies"]])
        render(h(ClientOptions), "en")
        expect(got.value.map(c => [c.id, c.name])).toEqual([["k2", "Beta Supplies"], ["k1", "Al Noor Trading"], ["k3", "Delta Foods"]])
    })

    it("of the bulk upload's rows: its client select and each row's people and client", async () => {
        const { BulkRowFields } = await import("@/components/BulkTaskReviewModal")
        const row = { line: 2, title: "Count stock", description: "", clientId: null, unknownClient: "", locationId: null, locationText: "", assigneeIds: [], unknownPeople: [], deadline: "", unreadDeadline: "", difficulty: 0 }
        const props = { row, onChange: () => {}, people: [], onRetryPeople: () => {}, retryingPeople: false, clients: [BETA, NOOR], places: [], now: Date.parse("2026-11-24T12:00:00Z") }
        inOrder(render(h(BulkRowFields, props), "ar"), [">النور للتجارة</option>", ">Beta Supplies</option>"])
        inOrder(render(h(BulkRowFields, props), "en"), [">Beta Supplies</option>", ">Al Noor Trading</option>"])
        // The client picked names its locations' group.
        const picked = { ...props, row: { ...row, clientId: "k1" }, places: [{ id: "l1", name: "Main shop", clientId: "k1", isHq: true, needsPin: false }] }
        expect(render(h(BulkRowFields, picked as never), "ar")).toContain(`label="${ar.task_location_client_group.replace("{name}", "النور للتجارة")}"`)
        const modal = read("components/BulkTaskReviewModal.tsx")
        expect(modal).toContain("return person ? personName(person, locale) : null")
        expect(modal).toContain("return client && clientName(client, locale)")
        expect(modal).toContain("const client = clientOf(row.clientId)")
    })
})
