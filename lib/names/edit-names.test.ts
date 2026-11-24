import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, url, PEOPLE } from "@/lib/permissions/employee-access.harness"
import { encodeGrants } from "@/lib/permissions/grants"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { serializeAccess, resolveBundles } from "@/lib/features/bundles"

vi.setConfig({ testTimeout: 60_000 })

/**
 * A name edited, in both languages (LATER_CHANGES_PLAN.md §3.1, step 4b, PR
 * 403; DESIGN.md §5.3): PUT /api/users takes a name's English only written in
 * English letters and with its Arabic, sent with it or kept, whatever sends
 * it, as the profile's form sends both. Its Arabic alone may be added. An
 * edit that sends no name leaves them as they are; a Super Admin's name is
 * kept once (lib/permissions/custom-role-edits.test.ts), and one's own on an
 * employee's or a team leader's footing is asked for, not changed.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("next-auth/jwt", () => ({ getToken: async () => null }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

const as = (id: string, role: "ADMIN" | "EMPLOYEE") => ({
    user: { id, role, companyId: "c1", grants: encodeGrants(BUILT_IN_GRANTS[role] as any), featureAccess: serializeAccess(resolveBundles(null, { isSuperAdmin: false })) },
})
beforeEach(() => {
    state.written.length = 0
    state.session = as("admin", "ADMIN")
})

const put = async (body: Record<string, unknown>) => (await import("@/app/api/users/route")).PUT(new Request(url("/api/users"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
}))
/** What the route says is wrong, by field. */
const refused = async (res: Response) => {
    const body = await res.json()
    return Object.fromEntries(Object.entries(body.details ?? {}).map(([field, said]: [string, any]) => [field, said?._errors?.[0]]))
}
const both = { firstName: "Eman", firstNameAr: "إيمان", lastName: "Mahmoud", lastNameAr: "محمود" }

describe("a name edited, in both languages", () => {
    it("is saved with each in English and in Arabic", async () => {
        const res = await put({ id: "emp", ...both })
        expect(res.status).toBe(200)
        expect(state.written.at(-1)).toMatchObject(both)
    })

    it("isn't saved in English with no Arabic, sent or kept", async () => {
        // The fixture person's names have no Arabic yet.
        expect(PEOPLE.emp.firstNameAr).toBeUndefined()
        const first = await put({ id: "emp", firstName: "Eman", lastName: "Mahmoud", lastNameAr: "محمود" })
        expect(first.status).toBe(400)
        expect(await refused(first)).toEqual({ firstNameAr: "Needed in Arabic" })
        const last = await put({ id: "emp", firstName: "Eman", firstNameAr: "إيمان", lastName: "Mahmoud" })
        expect(await refused(last)).toEqual({ lastNameAr: "Needed in Arabic" })
        expect(state.written).toEqual([])
    })

    it("isn't saved with its English in Arabic letters", async () => {
        const res = await put({ id: "emp", ...both, lastName: "محمود" })
        expect(res.status).toBe(400)
        expect(await refused(res)).toEqual({ lastName: "Written in English letters" })
        expect(state.written).toEqual([])
    })

    it("takes its Arabic alone, added", async () => {
        const res = await put({ id: "emp", firstNameAr: "إيمان", lastNameAr: "محمود" })
        expect(res.status).toBe(200)
        expect(state.written.at(-1)).toMatchObject({ firstNameAr: "إيمان", lastNameAr: "محمود" })
    })

    it("leaves them as they are in an edit that sends no name", async () => {
        const res = await put({ id: "emp", gender: "FEMALE" })
        expect(res.status).toBe(200)
        expect(Object.keys(state.written.at(-1) ?? {})).not.toContain("firstName")
    })

    it("isn't asked of one's own name on an employee's footing, which is asked for, not changed", async () => {
        state.session = as("emp", "EMPLOYEE")
        // Sent back as it is, with the rest of the profile: no change, and nothing asked of it.
        const res = await put({ id: "emp", firstName: PEOPLE.emp.firstName, lastName: PEOPLE.emp.lastName, gender: "FEMALE" })
        expect(res.status).toBe(200)
    })
})
