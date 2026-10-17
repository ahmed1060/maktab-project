import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "@/lib/strip-comments"
import { withGrants } from "./test-actors"

/**
 * Four places a screen disagreed with what its routes allow, fixed.
 *
 * - The client and section lists offered Edit and Delete to everyone, and the
 *   server refused anyone without clients.edit or clients.delete. Those are a
 *   client's records now (records.*), and their screens ask the same.
 * - The Costs page listed every pending payment in the company to a Team
 *   Leader, who pays only their team's tasks.
 * - The obligations page listed the whole company's obligations to a Team
 *   Leader, and refused them when they opened one outside their team.
 * - The dashboard's approval counters named ADMIN, so a Super Admin looking at
 *   one company saw no leave or name-change queue although they may decide both.
 */

const state = { session: null as any, where: null as any }

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) } }))
vi.mock("@/app/(dashboard)/dashboard/costs/CostsClient", () => ({ default: () => null }))
vi.mock("@/app/(dashboard)/dashboard/obligations/ObligationsClient", () => ({ default: () => null }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        company: { findUnique: async () => null },
        task: {
            findMany: async ({ where }: any) => { state.where = where; return [] },
            count: async () => 0,
        },
        obligation: {
            findMany: async ({ where }: any) => { state.where = where; return [] },
            count: async () => 0,
        },
    },
}))

async function costsWhereFor(user: Record<string, unknown>) {
    state.session = { user: withGrants(user) }
    state.where = null
    const { default: CostsPage } = await import("@/app/(dashboard)/dashboard/costs/page")
    await CostsPage({ searchParams: Promise.resolve({}) })
    return JSON.stringify(state.where)
}

async function obligationsWhereFor(user: Record<string, unknown>, query: Record<string, string> = {}) {
    state.session = { user: withGrants(user) }
    state.where = null
    const { default: ObligationsPage } = await import("@/app/(dashboard)/dashboard/obligations/page")
    await ObligationsPage({ searchParams: Promise.resolve(query) } as any)
    return JSON.stringify(state.where)
}

describe("the Costs page shows what its viewer may pay", () => {
    it("narrows a Team Leader to tasks with someone on their team", async () => {
        const where = await costsWhereFor({ id: "tl", role: "TEAM_LEADER", companyId: "c1" })
        expect(where).toContain('{"assignees":{"some":{"OR":[{"teamLeaderId":"tl"},{"id":"tl"}]}}}')
    })

    it("leaves an Admin the whole company", async () => {
        const where = await costsWhereFor({ id: "admin", role: "ADMIN", companyId: "c1" })
        expect(where).toContain('"companyId":"c1"')
        expect(where).not.toContain("teamLeaderId")
    })
})

const source = (path: string) => stripComments(readFileSync(path, "utf8"))

describe("record screens offer only what the server allows", () => {
    const LIST = source("components/records/RecordsList.tsx")
    const SECTIONS = source("components/records/SectionsCard.tsx")
    const VIEW = source("components/records/RecordDialog.tsx")

    it("adds a record from the Records page in one form, choosing its client there, only with records.contribute", () => {
        const PAGE = source("app/(dashboard)/dashboard/records/page.tsx")
        const CLIENT = source("app/(dashboard)/dashboard/vendors/[id]/page.tsx")
        const FORM = source("components/records/RecordForm.tsx")
        expect(PAGE).toContain("action={can('records.contribute') && <Button")
        expect(PAGE).toContain("<RecordsList adding={adding && can('records.contribute')} onAddingChange={setAdding} />")
        expect(LIST).toContain("action={canEdit && onAddingChange ? <Button")
        // The form opens on the Records page itself, with no client given, and the record is added there.
        expect(LIST).toContain("<RecordForm open={adding} onClose={() => onAddingChange?.(false)} vendorId={vendorId} sections={vendorId ? sections : undefined} onSaved={changed} />")
        expect(FORM).toContain("const choosing = !vendorId && !editing")
        expect(FORM).not.toContain("router.push")
        expect(CLIENT).toContain("adding={adding && can('records.contribute')}")
        expect(CLIENT).not.toContain("params.get('add')")
    })
    it("loads the chosen client's sections before a record can be added to it, rather than starting a first one", () => {
        const FORM = source("components/records/RecordForm.tsx")
        expect(FORM).toContain("choosing && clientId ? `/api/records/sections?vendorId=${encodeURIComponent(clientId)}` : null")
        expect(FORM).toContain("const ready = !!clientId && list !== undefined")
        expect(FORM).toContain("busy={saving} disabled={!ready}")
        expect(FORM).toContain("{t('records_sections_failed')}")
        // A section of the client before isn't what the record goes into.
        expect(FORM).toContain("const section = sectionId === NEW_SECTION || list?.some(s => s.id === sectionId) ? sectionId : list?.[0]?.id ?? NEW_SECTION")
    })
    it("on the Records page, finds any client by name to add a record to, not only the first ones listed", () => {
        const CLIENTS = source("components/records/useClients.ts")
        const FORM = source("components/records/RecordForm.tsx")
        expect(FORM).toContain("<SearchInput {...p} autoComplete=\"off\" value={clients.query}")
        expect(CLIENTS).toContain("if (search) params.set('search', search)")
        // A choice a search no longer lists isn't what the record is added to.
        expect(FORM).toContain("const clientId = vendorId ?? (clients.clients.some(c => c.id === chosen) ? chosen : clients.clients[0]?.id ?? '')")
    })
    it("on a client's page, says when its details didn't load, though its records did", () => {
        const CLIENT = source("app/(dashboard)/dashboard/vendors/[id]/page.tsx")
        expect(CLIENT).toContain("const detailsFailed = seesVendor && !vendorBody")
        expect(CLIENT).toContain("{detailsFailed && (")
        expect(CLIENT).toContain("title={t('vendor_details_failed')} action={<Button onClick={() => { void reloadVendor() }}>{t('try_again')}</Button>}")
    })
    it("on a client's page, says when its sections didn't load, rather than showing none and starting a first one", () => {
        const CLIENT = source("app/(dashboard)/dashboard/vendors/[id]/page.tsx")
        expect(CLIENT).toContain("const sectionsFailed = seesRecords && !sectionsBody")
        expect(CLIENT).toContain("action={seesRecords && !sectionsFailed && can('records.contribute') && <Button")
        expect(CLIENT).toContain("{sectionsFailed && (")
        expect(CLIENT).toContain("title={t('records_load_failed')} action={<Button onClick={() => { void reloadSections() }}>{t('try_again')}</Button>}")
        expect(CLIENT).toContain("{seesRecords && !sectionsFailed && (")
    })
    it("offers editing a record only with records.contribute", () => {
        expect(LIST).toContain("const canEdit = can('records.contribute')")
        expect(LIST).toContain("...(canEdit ? [{ key: 'edit'")
        expect(LIST).toContain("onEdit={canEdit && viewing ?")
        expect(VIEW).toContain("{onEdit && <Button")
    })
    it("offers deleting a record only with records.delete", () => {
        expect(LIST).toContain("const canDelete = can('records.delete')")
        expect(LIST).toContain("...(canDelete ? [{ key: 'delete'")
        expect(LIST).toContain("onDelete={canDelete && viewing ?")
        expect(VIEW).toContain("{onDelete && <Button")
    })
    it("offers renaming a section only with records.edit", () => {
        expect(SECTIONS).toContain("const canRename = can('records.edit')")
        expect(SECTIONS).toContain("...(canRename ? [{ key: 'rename'")
    })
    it("offers deleting a section only with records.delete", () => {
        expect(SECTIONS).toContain("const canDelete = can('records.delete')")
        expect(SECTIONS).toContain("...(canDelete ? [{ key: 'delete'")
    })
})

describe("the dashboard's approval queues follow the approval permissions", () => {
    const page = source("app/(dashboard)/dashboard/page.tsx")

    it("counts and links leave by dayoff.approve", () => {
        expect(page.match(/can\(viewer, 'dayoff\.approve'\)/g)).toHaveLength(2)
    })
    it("counts and links name changes by profile_requests.review", () => {
        expect(page.match(/can\(viewer, 'profile_requests\.review'\)/g)).toHaveLength(2)
    })
    it("no longer names ADMIN for them", () => {
        expect(page).not.toMatch(/userRole === 'ADMIN'/)
    })
})

describe("the obligations page shows a Team Leader their team's", () => {
    it("narrows a Team Leader to obligations with someone on their team", async () => {
        const where = await obligationsWhereFor({ id: "tl", role: "TEAM_LEADER", companyId: "c1" })
        expect(where).toContain('{"assignees":{"some":{"OR":[{"teamLeaderId":"tl"},{"id":"tl"}]}}}')
    })

    it("leaves an Admin the whole company", async () => {
        const where = await obligationsWhereFor({ id: "admin", role: "ADMIN", companyId: "c1" })
        expect(where).toContain('"companyId":"c1"')
        expect(where).not.toContain("teamLeaderId")
    })

    it("keeps an employee to their own, whatever they filter by", async () => {
        const where = await obligationsWhereFor({ id: "emp", role: "EMPLOYEE", companyId: "c1" }, { employeeId: "someone" })
        expect(where).toContain('{"assignees":{"some":{"id":"emp"}}}')
        expect(where).not.toContain("someone")
    })

    it("leaves a Super Admin every company unless one is picked", async () => {
        expect(await obligationsWhereFor({ id: "sa", role: "SUPER_ADMIN", companyId: null })).not.toContain("companyId")
    })

    it("keeps the team scope when filtered to one employee", async () => {
        const where = await obligationsWhereFor({ id: "tl", role: "TEAM_LEADER", companyId: "c1" }, { employeeId: "someone" })
        expect(where).toContain('"teamLeaderId":"tl"')
        expect(where).toContain('{"assignees":{"some":{"id":"someone"}}}')
    })
})
