import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { withGrants } from "@/lib/permissions/test-actors"
import { can as canFor } from "@/lib/permissions/can"
import { encodeGrants } from "@/lib/permissions/grants"
import { profileAccess } from "@/lib/profile-access"
import { monthLabel } from "@/lib/owners"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * Owners on the screens (LATER_CHANGES_PLAN.md §7.3, step 3a, PR 426):
 * among a person's details, Owner since a month, to whoever sees their
 * profile, with Add to owners or Remove from owners for whoever may set it;
 * the dialog that says what changes and asks; and the route behind it.
 */

const ui = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: ui.locale, t: (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))

const source = (path: string) => stripComments(readFileSync(path, "utf8"))
const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
const employee = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" })
const superAdmin = withGrants({ id: "s1", role: "SUPER_ADMIN", companyId: null })
const has = () => true
type Viewer = { id: string; role: string; companyId: string | null; grants?: string }
const access = (viewer: Viewer, person: { id: string; role: string }) =>
    profileAccess({ can: (p: string) => canFor(viewer, p as never), has, viewer, person })

describe("who sees the mark, and who sets it", () => {
    it("shows it on everyone's with a company, one's own too, but a Super Admin's", () => {
        expect(access(admin, { id: "e2", role: "EMPLOYEE" }).owner).toBe(true)
        expect(access(employee, { id: "e1", role: "EMPLOYEE" }).owner).toBe(true)
        expect(access(superAdmin, { id: "s2", role: "SUPER_ADMIN" }).owner).toBe(false)
        expect(access(admin, { id: "e2", role: "" }).owner).toBe(false)
    })

    it("lets whoever holds the permission set it, never on one's own, and an Admin's the Super Admin alone", () => {
        expect(access(admin, { id: "e2", role: "EMPLOYEE" }).setOwner).toBe(true)
        expect(access(admin, { id: "a1", role: "ADMIN" }).setOwner).toBe(false)
        expect(access(admin, { id: "a2", role: "ADMIN" }).setOwner).toBe(false)
        expect(access(superAdmin, { id: "a2", role: "ADMIN" }).setOwner).toBe(true)
        expect(access(superAdmin, { id: "s2", role: "SUPER_ADMIN" }).setOwner).toBe(false)
        expect(access(employee, { id: "e2", role: "EMPLOYEE" }).setOwner).toBe(false)
        const holder = { id: "h2", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants({ "employees.view": "COMPANY", "employees.set_owner": "COMPANY" }) }
        expect(access(holder, { id: "e2", role: "EMPLOYEE" }).setOwner).toBe(true)
        expect(access(holder, { id: "h2", role: "EMPLOYEE" }).setOwner).toBe(false)
        // Seeing them, or changing their contract start, isn't setting it.
        const other = { id: "h3", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants({ "employees.view": "COMPANY", "employees.edit_contract_start": "COMPANY" }) }
        expect(access(other, { id: "e2", role: "EMPLOYEE" }).changeContractStart).toBe(true)
        expect(access(other, { id: "e2", role: "EMPLOYEE" }).setOwner).toBe(false)
    })

    it("never lets the permission reach one's own, whoever holds it", () => {
        const holder = { id: "h2", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants({ "employees.view": "COMPANY", "employees.set_owner": "COMPANY" }) }
        expect(canFor(holder, "employees.set_owner", { companyId: "c1", userId: "e2", teamLeaderId: null })).toBe(true)
        expect(canFor(holder, "employees.set_owner", { companyId: "c1", userId: "h2", teamLeaderId: null })).toBe(false)
    })
})

describe("a person's details", () => {
    const facts = {
        email: "mona@example.com", username: "mona", gender: "FEMALE", company: null, role: "Employee", acting: null, teamLeader: null,
        status: "ACTIVE", salary: "", dayOffCredit: "0", contractStart: null, accountMade: null, ownerSince: null as string | null,
    }
    const view = async (locale: "en" | "ar", shown: Partial<ReturnType<typeof access>>, ownerSince: string | null) => {
        ui.locale = locale
        const { ProfileView } = await import("@/components/profile/ProfileView")
        const base = access(admin, { id: "e2", role: "EMPLOYEE" })
        return renderToStaticMarkup(h(ProfileView, {
            name: "Mona Adel", photo: null, access: { ...base, ...shown }, facts: { ...facts, ownerSince },
            onResetPassword: () => {}, onEndContract: () => {}, onSetOwner: () => {},
        }))
    }

    it("says since when they're an owner, in the page's language", async () => {
        const html = await view("en", { setOwner: false }, "2026-11")
        expect(html).toContain("Owner")
        expect(html).toContain("Since November 2026")
        expect(html).not.toContain("Remove from owners")
        const arabic = await view("ar", { setOwner: false }, "2026-11")
        expect(arabic).toContain("ضمن الملاك")
        expect(arabic).toContain("منذ نوفمبر ٢٠٢٦")
    })

    it("offers to take it off, or put it on, to whoever may, named by the words it shows", async () => {
        // Named by what it says, so asking for it by those words finds it: on one person's details, it can't be anyone else's.
        const on = await view("en", { setOwner: true }, "2026-11")
        expect(on).toMatch(/<button[^>]*>Remove from owners<\/button>/)
        const not = await view("en", { setOwner: true }, null)
        expect(not).toContain(">No<")
        expect(not).toMatch(/<button[^>]*>Add to owners<\/button>/)
        expect(on + not).not.toContain("aria-label=\"Add")
        expect(on + not).not.toContain("aria-label=\"Remove")
    })

    it("says nothing of it to anyone else about someone who isn't one", async () => {
        expect(await view("en", { setOwner: false }, null)).not.toContain("Owner")
        expect(await view("en", { owner: false, setOwner: false }, "2026-11")).not.toContain("Owner")
    })

    it("words a month in either language", () => {
        expect(monthLabel("2026-11", "en")).toBe("November 2026")
        expect(monthLabel("2026-11", "ar")).toBe("نوفمبر ٢٠٢٦")
    })
})

describe("the dialog, the route and the form", () => {
    it("says what changes from this month, and what it's refused for, in either language", () => {
        for (const words of [en, ar]) {
            for (const key of ["owner_add_title", "owner_remove_title", "owner_add_says", "owner_remove_says", "owner_add", "owner_remove", "owner_added", "owner_removed",
                "owner_open_work", "owner_month_locked", "owner_already", "owner_not", "owner_no_company", "owner_settled", "owner_work_task", "owner_work_obligation"] as const) {
                expect(words[key], key).toBeTruthy()
            }
        }
        const dialog = source("components/profile/OwnerDialog.tsx")
        expect(dialog).toContain("const res = await fetch(`/api/users/${encodeURIComponent(userId)}/owner`, {")
        expect(dialog).toContain("body: JSON.stringify({ owner: !owner }),")
        expect(dialog).toContain("const refused = ownerRefusal(body?.code)")
        expect(dialog).toContain("setWork(body?.work ?? [])")
    })

    it("sets it with its own permission, never one's own, an Admin's by the Super Admin, confirmed with a code", () => {
        const route = source("app/api/users/[id]/owner/route.ts")
        expect(route).toContain(`if (!can(session.user, "employees.set_owner")) return ApiResponse.forbidden`)
        expect(route).toContain(`if (userId === session.user.id) return ApiResponse.forbidden`)
        expect(route).toContain(`!can(session.user, "employees.set_owner", person)`)
        expect(route).toContain(`if (!(await verifyResourceAccess(session, userId, "USER"))) return ApiResponse.forbidden`)
        expect(route).toContain("RoleAssignmentService.onlySuperAdminActsOnAdmins(session.user, target)")
        expect(route).toContain(`await assertStepUp(session, "employees.set_owner")`)
        expect(route).toContain(`if (typeof json?.owner !== "boolean") return ApiResponse.badRequest`)
        expect(route).toContain("return ApiResponse.refused(refusal[0], refusal[1], error.message, error.work.length > 0 ? { work: error.work } : undefined)")
    })

    it("says why an owner's month settles at nothing, in either language", () => {
        expect(source("components/profile/EndContractDialog.tsx")).toContain("settlement.paidSource === 'OWNER'")
        expect(en.settlement_owner_month).toBeTruthy()
        expect(ar.settlement_owner_month).toBeTruthy()
    })

    it("gives the month with a person, and opens the dialog from their details", () => {
        expect(source("app/api/users/route.ts")).toContain("ownerSince: owner?.since ?? null,")
        const form = source("components/EmployeeProfileForm.tsx")
        expect(form).toContain("setOwnerSince(employee.ownerSince ?? null)")
        expect(form).toContain("onSetOwner={() => setSettingOwner(true)}")
        expect(form).toContain("onDone={owner => { setOwnerSince(owner ? today.slice(0, 7) : null); setSettingOwner(false) }}")
    })
})
