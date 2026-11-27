import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * An obligation's client (LATER_CHANGES_PLAN.md §7.7, 7a; DESIGN.md §5.5,
 * An obligation's client), picked as a task's is: on Add obligation for
 * whoever may see clients, kept each time a repeating one comes round,
 * shown in the list and on its page, and a filter on the list.
 */

const viewer = { clients: true, role: "ADMIN", company: null as string | null }
const options = { clients: [{ id: "k1", name: "Nile Foods", archived: false }], loading: false, failed: false }
const asked: boolean[] = []
const address = { query: "" }
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    useSearchParams: () => new URLSearchParams(address.query),
}))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: viewer.company }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => "Obligations" }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "me", role: viewer.role } } }) }))
vi.mock("@/lib/useCan", () => ({
    useCan: () => ({ can: (p: string) => p === "clients.view" ? viewer.clients : p !== "locations.view", companyWide: () => true, scope: () => "COMPANY" }),
    permissionsOf: () => ({ can: () => true, companyWide: () => true }),
}))
vi.mock("@/components/locations/useClientOptions", () => ({
    useClientOptions: (on: boolean) => {
        asked.push(on)
        return { ...options, clients: on ? options.clients : [], retrying: false, retry: () => {} }
    },
}))
vi.mock("@/components/DateRangePicker", () => ({ default: () => null }))
vi.mock("@/components/AccessDenied", () => ({ default: () => "access-denied" }))

const read = (path: string) => readFileSync(path, "utf8")
const FORM = "app/(dashboard)/dashboard/obligations/new/page.tsx"
const LIST = "app/(dashboard)/dashboard/obligations/ObligationsClient.tsx"
const LIST_PAGE = "app/(dashboard)/dashboard/obligations/page.tsx"
const DETAIL = "app/(dashboard)/dashboard/obligations/[id]/client.tsx"
const DETAIL_PAGE = "app/(dashboard)/dashboard/obligations/[id]/page.tsx"
const SERVICE = "lib/services/obligation.service.ts"

async function form(as: Partial<typeof viewer> = {}) {
    Object.assign(viewer, { clients: true, role: "ADMIN", company: null }, as)
    asked.length = 0
    const { default: NewObligationPage } = await import("@/app/(dashboard)/dashboard/obligations/new/page")
    return renderToStaticMarkup(h(NewObligationPage))
}

const NOW = Date.parse("2026-11-27T10:00:00Z")
const obligation = (fields: object = {}) => ({
    id: "o1", title: "Monthly VAT return", status: "PENDING", difficulty: 2, recurrence: "MONTHLY",
    deadline: "2026-12-15T09:00:00Z", createdAt: "2026-11-01T09:00:00Z", updatedAt: "2026-11-01T09:00:00Z",
    lastStatusUpdateBy: null, assignees: [{ id: "u2", firstName: "Mona", lastName: "Adel" }],
    client: { name: "Nile Foods", nameAr: "نايل فودز" },
    ...fields,
})
async function list(rows: ReturnType<typeof obligation>[], as: Partial<typeof viewer> = {}, query = "") {
    Object.assign(viewer, { clients: true, role: "ADMIN", company: null }, as)
    address.query = query
    const { default: ObligationsClient } = await import("@/app/(dashboard)/dashboard/obligations/ObligationsClient")
    return renderToStaticMarkup(h(ObligationsClient, { obligations: rows, total: rows.length, page: 1, totalPages: 1, currentUserId: "me", now: NOW }))
}

describe("an obligation's client, as it's asked for", () => {
    it("is optional, an id or none", async () => {
        const { createObligationSchema } = await import("./validations/obligation.schema")
        const base = { title: "Monthly VAT return", description: "Filed for the client each month", assigneeIds: ["u2"], deadline: "2026-12-15T09:00:00Z" }
        expect(createObligationSchema.parse(base).clientId).toBeUndefined()
        expect(createObligationSchema.parse({ ...base, clientId: null }).clientId).toBeNull()
        expect(createObligationSchema.parse({ ...base, clientId: "k1" }).clientId).toBe("k1")
        expect(createObligationSchema.safeParse({ ...base, clientId: "" }).success).toBe(false)
        expect(createObligationSchema.safeParse({ ...base, clientId: 3 }).success).toBe(false)
    })

    it("is picked under the description, No client first, then the clients that aren't archived", async () => {
        const html = await form()
        expect(html).toMatch(/class="ui-label"[^>]*>location_client</)
        expect(html).toContain("obligation_client_hint")
        const select = html.match(/<select[^>]*name="clientId"[\s\S]*?<\/select>/)?.[0] ?? ""
        expect(select).toMatch(/<option value="" selected="">task_no_client<\/option><option value="k1">Nile Foods<\/option>/)
        expect(html.indexOf('name="clientId"')).toBeGreaterThan(html.indexOf('name="description"'))
        expect(html.indexOf('name="clientId"')).toBeLessThan(html.indexOf("assignees_label"))
        // The form asks only for those in use.
        const source = read(FORM)
        expect(source).toContain("const clients = useClientOptions(mayCreate && seesClients)")
        expect(source).toContain("...clients.clients.filter(c => !c.archived).map(c => ({ value: c.id, label: c.name }))")
    })

    it("isn't asked without See clients, and a Super Admin's waits for a company", async () => {
        expect(await form({ clients: false })).not.toContain('name="clientId"')
        expect(asked.every(on => !on)).toBe(true)
        expect(await form({ role: "SUPER_ADMIN" })).not.toContain('name="clientId"')
        expect(asked.every(on => !on)).toBe(true)
        expect(await form({ role: "SUPER_ADMIN", company: "c1" })).toContain('name="clientId"')
        expect(read(FORM)).toContain("const seesClients = useCan().can('clients.view') && !(superAdmin && !selectedCompanyId)")
    })

    it("says when the clients didn't load, with Try again, and is no reason not to save", async () => {
        options.failed = true
        try {
            const html = await form()
            expect(html).toContain("records_clients_failed")
            expect(html).toContain("try_again")
            expect(html).not.toContain('name="clientId"')
        } finally { options.failed = false }
    })

    it("is sent, none as null, and a refusal is said under it, which takes the focus", () => {
        const source = read(FORM)
        expect(source).toContain("const FIELDS = ['title', 'description', 'clientId', 'assigneeIds', 'deadline', 'difficulty'] as const")
        expect(source).toContain("clientId: clientId || null,")
        expect(source).toContain("if (CLIENT_REFUSALS.includes(data.code)) {")
        expect(source).toContain("setFieldErrors({ clientId: t('obligation_client_refused') })")
        expect(source).toContain("setClientRefused(n => n + 1)")
        // Taken off, so what's shown is what would be sent.
        expect(source).toContain("if (CLIENT_REFUSALS.includes(data.code)) {\n                    setClientId('')")
        // Once it's on again: while it's being sent, the select is off.
        expect(source).toContain("if (clientRefused) document.querySelector<HTMLElement>('#field-clientId select')?.focus()")
        expect(source).toContain("const CLIENT_REFUSALS = ['CLIENT_NOT_FOUND', 'CROSS_COMPANY_CLIENT_FORBIDDEN', 'CLIENT_ARCHIVED']")
        expect(source).toContain("const started = !!(title || description || clientId ||")
    })

    it("is refused by the route with its code, for the form to say under the select", () => {
        const route = read("app/api/obligations/route.ts")
        expect(route).toContain(`if (error.message === 'CLIENT_NOT_FOUND') return ApiResponse.refused(404, "That client isn't there any more.", error.message)`)
        expect(route).toContain(`if (error.message === 'CROSS_COMPANY_CLIENT_FORBIDDEN') return ApiResponse.refused(403, "Cannot use a client from a different company", error.message)`)
    })
})

describe("an obligation's client, as the server takes it", () => {
    it("must be there, the obligation's company's and not archived, held while the obligation is written", () => {
        const service = read(SERVICE)
        const create = service.slice(service.indexOf("static async create"), service.indexOf("static async update"))
        expect(create).toContain("const resolvedClientId = clientId ? await clientFor(clientId, targetCompanyId) : null")
        expect(create).toContain("if (resolvedClientId) await holdClientInUse(tx, resolvedClientId)")
        expect(create).toContain("clientId: resolvedClientId,")
        // The same check as a task's, from one place.
        const tasks = read("lib/services/task.service.ts")
        expect(tasks).toContain('import { clientFor, holdClientInUse } from "./client-in-use"')
        expect(tasks).toContain("const resolvedClientId = clientId ? await clientFor(clientId, targetCompanyId) : null")
    })

    it("is kept each time a repeating one comes round", () => {
        const service = read(SERVICE)
        const recur = service.slice(service.indexOf("static async processRecurrentObligations"))
        expect(recur).toContain("clientId: obl.clientId,")
    })

    it("isn't changed by an update", () => {
        const service = read(SERVICE)
        const update = service.slice(service.indexOf("static async update"), service.indexOf("static async delete"))
        expect(update).not.toContain("clientId")
    })

    it("is something obligations.create does less without, as tasks.create does", async () => {
        const { lessWithoutOf } = await import("./permissions/catalogue")
        expect(lessWithoutOf("obligations.create")).toEqual(["clients.view"])
        expect(en.roles_less_obligations_create_clients_view).toBe("no client can be picked for an obligation.")
        expect(ar.roles_less_obligations_create_clients_view).toBe("لا يمكن اختيار عميل للالتزام.")
    })
})

describe("an obligation's client, as it's shown", () => {
    it("is on the line under its title, before how often it comes round, with the client's icon", async () => {
        const html = await list([obligation()])
        const row = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"))
        expect(row).toContain("Nile Foods")
        expect(row.indexOf("Nile Foods")).toBeLessThan(row.indexOf("recurrence_monthly"))
        expect(row.match(/class="ui-item-detail"/g)?.length).toBe(2)
        const source = read(LIST)
        expect(source).toContain("cell: o => <ItemTitle title={title(o)} details={[...(client(o) ? [{ icon: StorefrontIcon, text: <bdi>{client(o)}</bdi> }] : []), ...(recurs(o) ? [{ icon: RepeatIcon, text: recurs(o) }] : [])]} />")
    })

    it("is a line of its own on a phone's card, before how often", async () => {
        const html = await list([obligation()])
        const card = html.slice(html.indexOf('<ul class="ui-cards"'))
        expect(card).toContain("Nile Foods")
        expect(card.indexOf("Nile Foods")).toBeLessThan(card.indexOf("recurrence_monthly"))
    })

    it("is left out where there's none, and the line under the title is how often alone", async () => {
        const html = await list([obligation({ client: null })])
        const row = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"))
        expect(row.match(/class="ui-item-detail"/g)?.length).toBe(1)
        expect(row).toContain("recurrence_monthly")
    })

    it("is named in the page's language, or the one it has", async () => {
        const { clientName } = await import("./client-list")
        expect(clientName({ name: "Nile Foods", nameAr: "نايل فودز" }, "ar")).toBe("نايل فودز")
        expect(read(LIST)).toContain("const client = (o: ObligationRow) => o.client ? clientName(o.client, locale) : undefined")
    })

    it("is read with the list, and with an obligation's page", () => {
        expect(read(LIST_PAGE)).toContain("client: { select: { name: true, nameAr: true } },")
        expect(read(DETAIL_PAGE)).toContain("client: { select: { name: true, nameAr: true } },")
    })

    it("is first in an obligation's page's details", () => {
        const detail = read(DETAIL)
        expect(detail).toContain("...(obligation.client ? [{ label: t('client_label'), value: <bdi>{clientName(obligation.client, locale)}</bdi> }] : []),")
        expect(detail.indexOf("t('client_label')")).toBeLessThan(detail.indexOf("t('assigned_by')"))
    })
})

describe("the list's client filter", () => {
    it("is Client after the status for whoever may see clients: All clients, No client, then every client", async () => {
        const html = await list([obligation()])
        expect(html).toMatch(/<label[^>]*class="ui-visually-hidden"[^>]*>location_client</)
        // Not for whoever may not see clients.
        expect(await list([obligation()], { clients: false })).not.toMatch(/>location_client</)
        const source = read(LIST)
        expect(source).toContain("const clientFilter = usePlaceFilters({ clientId: filters.clientId })")
        expect(source.indexOf("<ExtraFilterSelects filters={clientFilter} onPick={pickFilter} />")).toBeGreaterThan(source.indexOf("t('all_statuses')"))
        expect(source).toContain("go({ employeeId: '', status: '', dateFrom: '', dateTo: '', search: '', clientId: '', sortBy: '', sortOrder: '' })")
        expect(source).toContain("+ clientFilter.filter(f => f.value).length")
    })

    it("offers no location: an obligation has none", () => {
        const filters = read("components/locations/usePlaceFilters.ts")
        expect(filters).toContain("export function usePlaceFilters(picked: { clientId: string; locationId?: string }): ExtraFilter[] {")
        expect(filters).toContain("const seesLocations = placed && can('locations.view') && !waits")
        expect(filters).toContain("const placed = picked.locationId !== undefined")
    })

    it("narrows what's in scope, never widens it, on the page and the API, and not for someone who sees only their own", () => {
        const page = read(LIST_PAGE)
        expect(page).toContain("if (scope !== null) for (const narrower of placeFilters(clientId)) and(whereClause, narrower)")
        const api = read("app/api/obligations/route.ts")
        expect(api).toContain("if (reach !== null) for (const narrower of placeFilters(searchParams.get('clientId'))) and(whereClause, narrower)")
    })

    it("reads No client as none", async () => {
        const { placeFilters, NO_CLIENT } = await import("./place-filters")
        expect(placeFilters(NO_CLIENT)).toEqual([{ clientId: null }])
        expect(placeFilters("k1")).toEqual([{ clientId: "k1" }])
    })
})

describe("a client with obligations", () => {
    it("is archived rather than deleted, and stays in the archive", () => {
        const service = read("lib/services/client.service.ts")
        const body = service.slice(service.indexOf("static async delete"), service.indexOf("static async restore"))
        expect(body).toContain("const obligations = await tx.obligation.count({ where: { clientId: id } })")
        expect(body).toContain("const held = records > 0 || tasks > 0 || obligations > 0")
        const route = read("app/api/clients/route.ts")
        expect(route).toContain("_count: { select: { tasks: true, obligations: true, taxClaims: true, accounts: true } }")
        expect(route).toContain("inUse: _count.tasks > 0 || _count.obligations > 0 || recordSections.length > 0")
    })
})

describe("the words", () => {
    it("say it in both languages", () => {
        expect(en.obligation_client_hint).toBe("Optional. The client it's done for.")
        expect(ar.obligation_client_hint).toBe("اختياري. العميل الذي يُنجَز له.")
        expect(en.obligation_client_refused).toBe("This client can't be picked. It may have been archived or deleted since the form opened. Pick another, or No client.")
        expect(ar.obligation_client_refused).toBe("لا يمكن اختيار هذا العميل. ربما أُرشف أو حُذف بعد فتح النموذج. يُرجى اختيار عميل آخر، أو بدون عميل.")
    })

    it("count obligations with tasks and records where a client is archived for them", async () => {
        expect(en.clients_archive_question).toContain("It has tasks, obligations or records")
        expect(en.clients_archived_done).toBe("Archived: it has tasks, obligations or records")
        expect(en.clients_delete_for_good_in_use).toBe("It has tasks, obligations or records now, so it stays in the archive.")
        expect(ar.clients_archive_question).toContain("لديه مهام أو التزامات أو سجلات")
        expect(ar.clients_archived_done).toBe("تمت الأرشفة: لديه مهام أو التزامات أو سجلات")
        expect(ar.clients_delete_for_good_in_use).toBe("صار لديه مهام أو التزامات أو سجلات، لذلك يبقى في الأرشيف.")
        const { knownRefusal } = await import("./api-errors")
        expect(knownRefusal(new Error("CLIENT_IN_USE"))?.message).toBe("This client has tasks, obligations or records, so it stays in the archive.")
    })
})
