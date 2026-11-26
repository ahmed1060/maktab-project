import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { CrownIcon } from "@phosphor-icons/react/ssr"
import { stripComments } from "./strip-comments"
import { buildUserWhereClause, namesCountedParams } from "./services/user-query"
import { COMPANY_GROUPS, PAGES, shows, type SideBarViewer } from "./side-bar"
import { ITEM_ICONS } from "./side-bar-icons"
import { employeesListUrl } from "@/app/(dashboard)/dashboard/employees/list-query"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * The Owners list (LATER_CHANGES_PLAN.md §7.3, step 3c, PR 429): a page
 * after Employees under People, in its look, for whoever sees the whole
 * company's people; its people leave the Employees list. Each row has Edit
 * and Remove from owners, nothing about pay or points, and no button adds
 * one: an Admin is added from their details (DESIGN.md §5.5).
 */

const source = (path: string) => stripComments(readFileSync(path, "utf8"))
const PAGE = "app/(dashboard)/dashboard/owners/page.tsx"
const ROLES = ["ADMIN", "TEAM_LEADER", "EMPLOYEE", "SUPER_ADMIN"] as const
const STATUSES = ["ACTIVE", "OFFLINE", "SUSPENDED", "ARCHIVED", "DELETED"] as const
const admin = { user: { id: "a1", role: "ADMIN", companyId: "c1" } }
const where = (params: string) => {
    const built = buildUserWhereClause(admin, new URLSearchParams(params), undefined, ROLES, STATUSES)
    if (built.empty) throw new Error("empty")
    return built.whereClause
}

describe("who each list is for", () => {
    it("lists only the owners now for the Owners list, and leaves them out for the Employees list", () => {
        expect(where("owners=only").AND).toContainEqual({ ownerPeriods: { some: { endsAt: null } } })
        expect(where("owners=leave").AND).toContainEqual({ NOT: { ownerPeriods: { some: { endsAt: null } } } })
    })

    it("asks nothing of owners where a list doesn't say", () => {
        for (const params of ["", "owners=", "owners=all", "owners=yes"]) {
            expect(JSON.stringify(where(params)), params).not.toContain("ownerPeriods")
        }
    })

    it("counts the Employees list's names still missing a language over the same people", () => {
        expect(namesCountedParams(new URLSearchParams("owners=leave&search=x&page=2")).get("owners")).toBe("leave")
    })

    it("has the Employees list ask for everyone but the owners", () => {
        const base = { page: 1, limit: 10, teamOnly: false }
        expect(new URL(employeesListUrl({ ...base, owners: "leave" }), "http://x").searchParams.get("owners")).toBe("leave")
        expect(new URL(employeesListUrl(base), "http://x").searchParams.has("owners")).toBe(false)
        expect(source("app/(dashboard)/dashboard/employees/page.tsx")).toContain("owners: 'leave',")
    })
})

describe("its place in the side menu", () => {
    const viewer = (over: Partial<SideBarViewer>): SideBarViewer => ({
        superAdmin: false, can: () => false, has: () => true, checkIn: false, companySettings: false, cashAdvances: false, ...over,
    })

    it("comes after Employees under People, with its own page and the Crown", () => {
        expect(COMPANY_GROUPS.find(g => g.key === "people")?.items).toEqual(["employees", "owners", "attendance", "requests"])
        expect(PAGES.owners).toEqual({ href: "/dashboard/owners", labelKey: "owners_title" })
        expect(ITEM_ICONS.owners).toBe(CrownIcon)
    })

    it("is for whoever sees the whole company's people, the Super Admin too, not a team's only", () => {
        const sees = (p: string) => p === "employees.view"
        expect(shows("owners", viewer({ can: sees, companyWide: sees }))).toBe(true)
        expect(shows("owners", viewer({ can: sees, companyWide: () => false }))).toBe(false)
        expect(shows("owners", viewer({}))).toBe(false)
        expect(shows("owners", viewer({ superAdmin: true, can: () => true, companyWide: () => true }))).toBe(true)
    })

    it("hears whether the viewer sees the whole company's people", () => {
        expect(source("components/DashboardShell.tsx")).toContain("companyWide: permission => permissions.companyWide(permission),")
    })
})

describe("the page", () => {
    it("is there", () => {
        expect(existsSync(PAGE)).toBe(true)
    })

    const page = existsSync(PAGE) ? source(PAGE) : ""

    it("lists the owners, and is open to whoever sees the whole company's people", () => {
        expect(page).toContain("owners: 'only',")
        expect(page).toContain("if (viewer && !companyWide('employees.view')) return <AccessDenied />")
    })

    it("says since when, and nothing about pay or points", () => {
        expect(page).toContain("monthLabel(e.ownerSince, locale)")
        for (const word of ["points", "salary", "bonus", "deduction", "history", "Points", "Salary"]) expect(page, word).not.toContain(word)
    })

    it("offers Edit to whoever edits an Admin, and Remove from owners to whoever may take them off, never on one's own row", () => {
        expect(page).toContain("const own = (e: Owner) => e.id === viewer?.id")
        expect(page).toContain("const canEdit = (e: Owner) => !own(e) && editsProfile({ can, viewer, person: e })")
        expect(page).toContain("const canRemove = (e: Owner) => !own(e) && can('employees.set_owner') && (isSuperAdmin || userRole === 'ADMIN')")
        expect(page).toContain("<OwnerDialog")
        expect(page).toContain("owner={true}")
        expect(page).toContain("month={removing.thisMonth}")
    })

    it("names each row's buttons for its person, for whoever hears them", () => {
        expect(page).toContain("aria-label={t('owners_edit_named').replace('{name}', nameOf(e))}")
        expect(page).toContain("aria-label={t('owners_remove_named').replace('{name}', nameOf(e))}")
        // Each starts with the words on the button, for whoever says them to press it.
        for (const words of [en, ar]) {
            expect(words.owners_edit_named.startsWith(words.edit)).toBe(true)
            expect(words.owners_remove_named.startsWith(words.owner_remove)).toBe(true)
        }
    })

    it("has no button to add one: an Admin is added from their details", () => {
        expect(page).not.toContain("owner_add")
        expect(page).not.toContain("PageHeader title={t('owners_title')} subtitle={t('owners_subtitle')} action=")
        expect(page).toContain("<EmptyState icon={CrownIcon} title={t('owners_none')} detail={t('owners_none_body')} />")
    })
})

describe("what the list is sent", () => {
    const route = source("app/api/users/route.ts")

    it("says since when each owner is one, and their company's month now", () => {
        expect(route).toContain("const owners = searchParams.get('owners') === 'only' ? await OwnerService.sinceFor(users.map(u => u.id)) : null")
        expect(route).toContain("...(owners ? { ownerSince: owners.get(user.id)?.since ?? null, thisMonth: owners.get(user.id)?.month ?? null } : {}),")
    })
})

describe("its words", () => {
    const keys = [
        "owners_title", "owners_subtitle", "owners_since_column", "owners_edit_named", "owners_remove_named", "owners_none", "owners_none_body", "owners_none_found", "owners_load_failed",
        "count_owners_zero", "count_owners_one", "count_owners_two", "count_owners_few", "count_owners_many", "count_owners_other",
    ] as const

    it("are in English and Arabic", () => {
        for (const key of keys) {
            expect((en as Record<string, string>)[key], `en ${key}`).toBeTruthy()
            expect((ar as Record<string, string>)[key], `ar ${key}`).toBeTruthy()
        }
        expect(en.owners_title).toBe("Owners")
        expect(ar.owners_title).toBe("الملاك")
        expect(en.owners_none_body).toBe("An Admin is added to the owners from their details.")
    })
})
