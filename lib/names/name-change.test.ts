import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { state, prismaMock, url, PEOPLE } from "@/lib/permissions/employee-access.harness"
import { encodeGrants } from "@/lib/permissions/grants"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { serializeAccess, resolveBundles } from "@/lib/features/bundles"
import { createProfileRequestSchema } from "@/lib/validations/profile.schema"
import { approvedNames, bothLanguages } from "@/lib/names"
import { askedNameRefused } from "@/lib/profile-form"

vi.setConfig({ testTimeout: 60_000 })

/**
 * A request to change one's own name, in both languages (LATER_CHANGES_PLAN.md
 * §3.1, step 4c, PR 404): asked for on one's own profile on an employee's or a
 * team leader's footing, it carries each name in English and in Arabic, each
 * in its own letters, and keeps the ones it's from. Approved, it saves both.
 * One asked before, with its English only, is approved as PR 398 did.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("next-auth/jwt", () => ({ getToken: async () => null }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

const asked = { newFirstName: "Eman", newFirstNameAr: "إيمان", newLastName: "Mahmoud", newLastNameAr: "محمود" }
/** What the schema says is wrong, by field. */
const refusedBy = (body: Record<string, unknown>) => {
    const parsed = createProfileRequestSchema.safeParse(body)
    if (parsed.success) return {}
    const said = parsed.error.format() as Record<string, any>
    return Object.fromEntries(Object.keys(said).filter(k => k !== "_errors").map(k => [k, said[k]._errors]))
}

describe("a request to change one's name, as the server takes it", () => {
    it("carries each name in English and in Arabic, trimmed", () => {
        const parsed = createProfileRequestSchema.parse({ ...asked, newFirstName: " Eman ", newLastNameAr: " محمود " })
        expect(parsed).toEqual(asked)
    })

    it("needs both, each said under its own field", () => {
        expect(refusedBy({ newFirstName: "Eman", newLastName: "Mahmoud", newLastNameAr: "محمود" })).toEqual({ newFirstNameAr: ["Needed in Arabic"] })
        expect(refusedBy({ ...asked, newLastNameAr: " " })).toEqual({ newLastNameAr: ["Needed in Arabic"] })
        expect(refusedBy({ ...asked, newFirstName: "" })).toEqual({ newFirstName: ["Needed in English"] })
    })

    it("takes each in its own letters", () => {
        expect(refusedBy({ ...asked, newFirstName: "إيمان" })).toEqual({ newFirstName: ["Written in English letters"] })
        expect(refusedBy({ ...asked, newLastName: "محمود" })).toEqual({ newLastName: ["Written in English letters"] })
        expect(refusedBy({ ...asked, newFirstNameAr: "Eman" })).toEqual({ newFirstNameAr: ["Written in Arabic letters"] })
        expect(refusedBy({ ...asked, newLastNameAr: "Mahmoud" })).toEqual({ newLastNameAr: ["Written in Arabic letters"] })
    })

    it("takes each up to a person's name's limit", () => {
        const said = refusedBy({ ...asked, newFirstName: "E".repeat(31), newLastNameAr: "م".repeat(31) })
        expect(Object.keys(said)).toEqual(["newFirstName", "newLastNameAr"])
        expect(JSON.stringify(said)).not.toMatch(/letters|Needed/)
        expect(refusedBy({ ...asked, newFirstName: "E".repeat(30), newLastNameAr: "م".repeat(30) })).toEqual({})
    })
})

describe("its refusal, said on the profile", () => {
    it("is under the field the name is in, as the profile's own are", () => {
        const details = (field: string, why: string) => ({ error: "Validation Error", details: { [field]: { _errors: [why] } } })
        expect(askedNameRefused(details("newFirstNameAr", "Needed in Arabic"))).toEqual({ field: "firstNameAr", key: "name_required_ar" })
        expect(askedNameRefused(details("newLastName", "Written in English letters"))).toEqual({ field: "lastName", key: "name_not_english" })
        expect(askedNameRefused(details("newLastNameAr", "Written in Arabic letters"))).toEqual({ field: "lastNameAr", key: "name_not_arabic" })
        expect(askedNameRefused(details("newFirstName", "Too long"))).toEqual({ field: "firstName", key: "profile_first_name_invalid" })
    })

    it("is nobody's field otherwise, said above the buttons", () => {
        expect(askedNameRefused({ error: "You already have a pending name change request" })).toBeNull()
        expect(askedNameRefused({ error: "Validation Error", details: { email: { _errors: ["Invalid"] } } })).toBeNull()
        expect(askedNameRefused(null)).toBeNull()
    })
})

describe("asked for, at its route", () => {
    const as = (id: string, role: "ADMIN" | "EMPLOYEE" | "TEAM_LEADER") => ({
        user: { id, role, companyId: "c1", grants: encodeGrants(BUILT_IN_GRANTS[role] as any), featureAccess: serializeAccess(resolveBundles(null, { isSuperAdmin: false })) },
    })
    const post = async (body: Record<string, unknown>) => (await import("@/app/api/profile-requests/route")).POST(new Request(url("/api/profile-requests"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }))
    const kept = { ...PEOPLE.emp }
    beforeEach(() => { state.session = as("emp", "EMPLOYEE") })
    afterEach(() => { Object.assign(PEOPLE.emp, kept); delete PEOPLE.emp.firstNameAr; delete PEOPLE.emp.lastNameAr })

    it("keeps the names it's for and the ones it's from, each in both languages", async () => {
        Object.assign(PEOPLE.emp, { firstNameAr: "إ", lastNameAr: null })
        const res = await post(asked)
        expect(res.status).toBe(201)
        expect((await res.json()).data).toMatchObject({
            userId: "emp", status: "PENDING", ...asked,
            oldFirstName: PEOPLE.emp.firstName, oldLastName: PEOPLE.emp.lastName, oldFirstNameAr: "إ", oldLastNameAr: null,
        })
    })

    it("isn't asked with one language", async () => {
        const res = await post({ newFirstName: "Eman", newLastName: "Mahmoud" })
        expect(res.status).toBe(400)
        expect(Object.keys((await res.json()).details).filter(field => field !== "_errors")).toEqual(["newFirstNameAr", "newLastNameAr"])
    })

    it("isn't asked for the names they have, in either language", async () => {
        Object.assign(PEOPLE.emp, { firstName: "Eman", lastName: "Mahmoud", firstNameAr: "إيمان", lastNameAr: "محمود" })
        const same = await post(asked)
        expect(same.status).toBe(400)
        expect((await same.json()).error).toBe("New name is identical to current name")
        // Its Arabic alone is a change, either name's.
        expect((await post({ ...asked, newFirstNameAr: "إيمانة" })).status).toBe(201)
        expect((await post({ ...asked, newLastNameAr: "محمد" })).status).toBe(201)
    })
})

describe("approved", () => {
    const before = { firstName: "Karim", lastName: "Saeed", firstNameAr: null, lastNameAr: null }

    it("saves each name in both languages, as it was asked", () => {
        expect(approvedNames({ newFirstName: "Kareem", newFirstNameAr: "كريم", newLastName: "Saeed", newLastNameAr: "سعيد" }, before))
            .toEqual({ firstName: "Kareem", firstNameAr: "كريم", lastName: "Saeed", lastNameAr: "سعيد" })
    })

    it("asked before, with its English only, keeps an Arabic as PR 398 did", () => {
        // A name in Arabic is its Arabic too; one in English leaves the Arabic as it is.
        expect(approvedNames({ newFirstName: "كريم", newFirstNameAr: null, newLastName: "Saeed", newLastNameAr: null }, before))
            .toEqual({ firstName: "كريم", firstNameAr: "كريم", lastName: "Saeed" })
        // Unchanged, a corrected Arabic is kept.
        expect(approvedNames({ newFirstName: "كريم", newLastName: "سعيد" }, { firstName: "كريم", lastName: "Saeed", firstNameAr: "كريـم", lastNameAr: null }))
            .toEqual({ firstName: "كريم", lastName: "سعيد", lastNameAr: "سعيد" })
    })
})

describe("its names, shown in both languages", () => {
    it("the page's language first", () => {
        expect(bothLanguages("en", { en: "Karim Saeed", ar: "كريم سعيد" })).toEqual(["Karim Saeed", "كريم سعيد"])
        expect(bothLanguages("ar", { en: "Karim Saeed", ar: "كريم سعيد" })).toEqual(["كريم سعيد", "Karim Saeed"])
    })

    it("each once, and only the ones it has", () => {
        expect(bothLanguages("en", { en: "كريم سعيد", ar: "كريم سعيد" })).toEqual(["كريم سعيد"])
        expect(bothLanguages("ar", { en: "Karim Saeed", ar: null })).toEqual(["Karim Saeed"])
        expect(bothLanguages("en", { en: " ", ar: "كريم" })).toEqual(["كريم"])
        expect(bothLanguages("ar", { en: "Karim", ar: " " })).toEqual(["Karim"])
    })
})
