import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "@/lib/strip-comments"

/**
 * Three places a screen disagreed with what its routes allow, fixed.
 *
 * - The client and section lists offered Edit and Delete to everyone, and the
 *   server refused anyone without clients.edit or clients.delete.
 * - The Costs page listed every pending payment in the company to a Team
 *   Leader, who pays only their team's tasks.
 * - The dashboard's approval counters named ADMIN, so a Super Admin looking at
 *   one company saw no leave or name-change queue although they may decide both.
 */

const state = { session: null as any, where: null as any }

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) } }))
vi.mock("@/app/(dashboard)/dashboard/costs/CostsClient", () => ({ default: () => null }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        company: { findUnique: async () => null },
        task: {
            findMany: async ({ where }: any) => { state.where = where; return [] },
            count: async () => 0,
        },
    },
}))

async function costsWhereFor(user: Record<string, unknown>) {
    state.session = { user }
    state.where = null
    const { default: CostsPage } = await import("@/app/(dashboard)/dashboard/costs/page")
    await CostsPage({ searchParams: Promise.resolve({}) })
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

/** The JSX from a gate up to the handler it guards — the gate must come first. */
function gateBefore(path: string, handler: string): string {
    const s = source(path)
    const at = s.indexOf(handler)
    expect(at, `${handler} is in ${path}`).toBeGreaterThan(-1)
    return s.slice(s.lastIndexOf("<button", at) - 80, at)
}

describe("client screens offer only what the server allows", () => {
    const LIST = "app/(dashboard)/dashboard/clients/page.tsx"
    const DETAIL = "app/(dashboard)/dashboard/clients/[id]/page.tsx"

    it("offers renaming a client only with clients.edit", () => {
        expect(gateBefore(LIST, "setEditingClientId(client.id)")).toContain("can('clients.edit') && (")
    })
    it("offers deleting a client only with clients.delete", () => {
        expect(gateBefore(LIST, "setDeleteConfirm({ isOpen: true, client })")).toContain("can('clients.delete') && (")
    })
    it("offers renaming a section only with clients.edit", () => {
        expect(gateBefore(DETAIL, "setEditingSectionId(section.id)")).toContain("can('clients.edit') && (")
    })
    it("offers deleting a section only with clients.delete", () => {
        expect(gateBefore(DETAIL, "setDeleteConfirm({ isOpen: true, section })")).toContain("can('clients.delete') && (")
    })
})

describe("the dashboard's approval queues follow the approval permissions", () => {
    const page = source("app/(dashboard)/dashboard/page.tsx")

    it("counts and links leave by dayoff.approve", () => {
        expect(page.match(/can\(session!\.user as any, 'dayoff\.approve'\)/g)).toHaveLength(2)
    })
    it("counts and links name changes by profile_requests.review", () => {
        expect(page.match(/can\(session!\.user as any, 'profile_requests\.review'\)/g)).toHaveLength(2)
    })
    it("no longer names ADMIN for them", () => {
        expect(page).not.toMatch(/userRole === 'ADMIN'/)
    })
})
