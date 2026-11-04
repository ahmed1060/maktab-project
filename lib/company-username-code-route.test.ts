import { describe, it, expect, vi, beforeEach } from "vitest"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * The Create company dialog's suggestion for a username code: only for a
 * Super Admin, who is the only one adding companies, and for the name typed.
 */

const session = { value: null as any }
const asked: [string, string | null][] = []
vi.mock("next-auth", () => ({ getServerSession: async () => session.value }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/services/company.service", () => ({
    CompanyService: { suggestUsernameCode: async (name: string, id: string | null) => { asked.push([name, id]); return "ds" } },
}))

const get = (query: string) => new Request(`https://nizmo.test/api/companies/username-code?${query}`)

describe("a username code suggested for a company's name", () => {
    beforeEach(() => { session.value = null; asked.length = 0 })

    it("is for a Super Admin only", async () => {
        const { GET } = await import("@/app/api/companies/username-code/route")
        session.value = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1" }) }
        expect((await GET(get("name=Delta"))).status).toBe(403)
        expect(asked).toEqual([])
    })

    it("is worked out for the name, and the company being edited", async () => {
        const { GET } = await import("@/app/api/companies/username-code/route")
        session.value = { user: withGrants({ id: "sa1", role: "SUPER_ADMIN" }) }
        const res = await GET(get("name=Delta%20Sites&id=c1"))
        expect(res.status).toBe(200)
        expect((await res.json()).data).toEqual({ code: "ds" })
        expect(asked).toEqual([["Delta Sites", "c1"]])
        await GET(get("name=" + "x".repeat(80)))
        expect(asked[1]).toEqual(["x".repeat(50), null])
    })
})
