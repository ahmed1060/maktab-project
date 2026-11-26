import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { withGrants } from "@/lib/permissions/test-actors"
import { can as canFor } from "@/lib/permissions/can"
import { encodeGrants } from "@/lib/permissions/grants"
import { profileAccess } from "@/lib/profile-access"
import { contractStartRefusal } from "@/lib/contract-start"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * The contract start date on the screens (LATER_CHANGES_PLAN.md §7.2, step
 * 1, PR 425): among a person's details, to whoever sees their profile, with
 * Change beside it for whoever may change it; when their account was made,
 * for the Super Admin alone; and the date on Add employee.
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

describe("who sees the date, and who changes it", () => {
    it("shows it on everyone's with a company, one's own too, but a Super Admin's", () => {
        expect(access(admin, { id: "e2", role: "EMPLOYEE" }).contractStart).toBe(true)
        expect(access(employee, { id: "e1", role: "EMPLOYEE" }).contractStart).toBe(true)
        expect(access(superAdmin, { id: "s2", role: "SUPER_ADMIN" }).contractStart).toBe(false)
        expect(access(admin, { id: "e2", role: "" }).contractStart).toBe(false)
    })

    it("offers Change with the permission, never on one's own, and an Admin's to the Super Admin alone", () => {
        expect(access(admin, { id: "e2", role: "EMPLOYEE" }).changeContractStart).toBe(true)
        expect(access(admin, { id: "a1", role: "ADMIN" }).changeContractStart).toBe(false)
        expect(access(admin, { id: "a2", role: "ADMIN" }).changeContractStart).toBe(false)
        expect(access(superAdmin, { id: "a2", role: "ADMIN" }).changeContractStart).toBe(true)
        expect(access(employee, { id: "e2", role: "EMPLOYEE" }).changeContractStart).toBe(false)
        // Whoever edits people and their pay, without this permission: an HR role of the company's own.
        const hr = { id: "h1", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants({ "employees.view": "COMPANY", "employees.edit": "COMPANY", "salary.edit": "COMPANY" }) }
        expect(access(hr, { id: "e2", role: "EMPLOYEE" }).edit).toBe(true)
        expect(access(hr, { id: "e2", role: "EMPLOYEE" }).changeContractStart).toBe(false)
        // Whoever holds it, on their own profile: never their own date, as it's their own pay.
        const holder = { id: "h2", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants({ "employees.view": "COMPANY", "employees.edit_contract_start": "COMPANY" }) }
        expect(access(holder, { id: "e2", role: "EMPLOYEE" }).changeContractStart).toBe(true)
        expect(access(holder, { id: "h2", role: "EMPLOYEE" }).changeContractStart).toBe(false)
    })
})

describe("a person's details", () => {
    const facts = {
        email: "mona@example.com", username: "mona", gender: "FEMALE", company: null, role: "Employee", acting: null, teamLeader: null,
        status: "ACTIVE", salary: "", dayOffCredit: "0", contractStart: "2026-11-01", accountMade: null as string | null,
    }
    const view = async (locale: "en" | "ar", shown: Partial<ReturnType<typeof access>>, made: string | null = null) => {
        ui.locale = locale
        const { ProfileView } = await import("@/components/profile/ProfileView")
        const base = access(admin, { id: "e2", role: "EMPLOYEE" })
        return renderToStaticMarkup(h(ProfileView, {
            name: "Mona Adel", photo: null, access: { ...base, ...shown }, facts: { ...facts, accountMade: made },
            onResetPassword: () => {}, onEndContract: () => {}, onChangeContractStart: () => {},
        }))
    }

    it("says when their contract started, in the page's language", async () => {
        const html = await view("en", { changeContractStart: false })
        expect(html).toContain("Contract start date")
        expect(html).toContain("1 November 2026")
        expect(html).not.toContain(">Change<")
        const arabic = await view("ar", { changeContractStart: false })
        expect(arabic).toContain("تاريخ بداية العقد")
        expect(arabic).toContain("١ نوفمبر ٢٠٢٦")
    })

    it("offers Change beside it, named for whose it is, to whoever may change it", async () => {
        const html = await view("en", { changeContractStart: true })
        expect(html).toMatch(/aria-label="Change Mona Adel&#x27;s contract start date"[^>]*>Change</)
    })

    it("shows nothing of it where it isn't theirs to see", async () => {
        expect(await view("en", { contractStart: false })).not.toContain("Contract start date")
    })

    it("says when their account was made only when it's given, as it's given to the Super Admin alone", async () => {
        expect(await view("en", {})).not.toContain("Account made")
        const html = await view("en", {}, "2026-11-20")
        expect(html).toContain("Account made")
        expect(html).toContain("20 November 2026")
    })
})

describe("what's refused, said under the date", () => {
    it("says each refusal in words, and one about a month as a month to someone new", () => {
        expect(contractStartRefusal("CONTRACT_START_OUT_OF_RANGE")).toBe("contract_start_out_of_range")
        expect(contractStartRefusal("CONTRACT_START_SAME")).toBe("contract_start_same")
        expect(contractStartRefusal("CONTRACT_START_AFTER_CHANGE")).toBe("contract_start_after_change")
        expect(contractStartRefusal("PAYROLL_MONTH_LOCKED")).toBe("contract_start_payroll_locked")
        expect(contractStartRefusal("PAYROLL_MONTH_LOCKED", { creating: true })).toBe("contract_start_month_locked")
        expect(contractStartRefusal("NO_CONTRACT_START")).toBe("contract_start_none")
        expect(contractStartRefusal("USER_ALREADY_EXISTS")).toBeNull()
        expect(contractStartRefusal(undefined)).toBeNull()
    })
})

describe("the routes and the forms", () => {
    // Each is reached by a click or a request, so its code is read.
    it("takes the date on Add employee, today unless changed, and sends it", () => {
        const page = source("app/(dashboard)/dashboard/employees/new/page.tsx")
        expect(page).toContain(`<DatePickerSingle name="contractStart" label={t('contract_start_label')} hint={t('contract_start_hint')}`)
        expect(page).toContain("const [chosenStart, setChosenStart] = useState<string | null>(null)")
        expect(page).toContain("const contractStart = chosenStart ?? today")
        expect(page).toContain("onChange={day => { setChosenStart(day); setStartError(null) }}")
        expect(page).toContain("contractStartRefusal(answer?.code, { creating: true })")
    })

    it("has today in the company's calendar, the one chosen for the Super Admin, and sends the date only once it's changed (review on PR 425)", () => {
        const page = source("app/(dashboard)/dashboard/employees/new/page.tsx")
        expect(page).toContain("useSWR<{ data: { today: string } }>(mayCreate && startShown && (!isSuperAdmin || companyId) ? `/api/time${isSuperAdmin ? `?companyId=${encodeURIComponent(companyId)}` : ''}` : null, fetcher)")
        expect(page).toContain("const today = clock.data?.data.today ?? cairoToday")
        expect(page).toContain("value={contractStart} minDate={contractStartRange(today).min} maxDate={contractStartRange(today).max}")
        expect(page).toContain("if (startShown && chosenStart !== null) body.contractStart = chosenStart")
        expect(page).not.toContain("if (startShown) body.contractStart = contractStart")
    })

    it("answers the date's refusals with their codes when someone new is added", () => {
        const route = source("app/api/users/route.ts")
        expect(route).toContain(`"CONTRACT_START_OUT_OF_RANGE")`)
        expect(route).toContain(`"PAYROLL_MONTH_LOCKED")`)
    })

    it("gives the date with a person, and when their account was made to the Super Admin alone", () => {
        const route = source("app/api/users/route.ts")
        expect(route).toContain("contractStart: start?.date ?? null,")
        expect(route).toContain("...(session.user.role === 'SUPER_ADMIN' ? { accountMadeAt: start?.recordedAt.toISOString() ?? null } : {}),")
    })

    it("changes it with its own permission, never one's own, an Admin's by the Super Admin, confirmed with a code", () => {
        const route = source("app/api/users/[id]/contract-start/route.ts")
        expect(route).toContain(`if (!can(session.user, "employees.edit_contract_start")) return ApiResponse.forbidden`)
        expect(route).toContain(`if (userId === session.user.id) return ApiResponse.forbidden`)
        expect(route).toContain(`!can(session.user, "employees.edit_contract_start", person)`)
        expect(route).toContain("RoleAssignmentService.onlySuperAdminActsOnAdmins(session.user, target)")
        expect(route).toContain(`await assertStepUp(session, "employees.edit_contract_start")`)
    })

    it("opens the dialog from Change, and shows the date as changed after it", () => {
        const form = source("components/EmployeeProfileForm.tsx")
        expect(form).toContain("onChangeContractStart={() => setChangingStart(true)}")
        expect(form).toContain("onDone={date => { setContractStart(date); setChangingStart(false) }}")
        expect(form).toContain("setContractStart(employee.contractStart ?? null)")
    })
})
