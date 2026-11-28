import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readdirSync, readFileSync } from "node:fs"
import { withGrants } from "@/lib/permissions/test-actors"
import { PERMISSIONS } from "@/lib/permissions/catalogue"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { MEASURE_ONLY, SIX_DAY_FACTORY, STANDARD_OFFICE, policyBodySchema } from "@/lib/attendance/policy"
import { MISSION_MAX_DAYS, datesOf, missionDays, missionKey, missionSpan, missionScans } from "@/lib/attendance/missions"
import { missionRow, missionWhere } from "@/lib/requests/feed"
import { REQUEST_KINDS, type FeedRow } from "@/lib/requests/kinds"
import { attendanceNoticeTarget } from "@/lib/attendance-notice-target"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * Missions asked for and decided on the one Requests page
 * (ATTENDANCE_PLAN.md §6.10, round 10, Phase 5 part 4, PR 283): Decide
 * missions, the policy's Missions switch, the dates a mission may have, the
 * feed's rows on Mine and To review, the page that asks and decides them,
 * the notice of a decision, and payroll's window counting those waiting.
 * The rules that need a database are in lib/mission-requests.db.test.ts.
 */

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    useSearchParams: () => new URLSearchParams(""),
    usePathname: () => "/dashboard/requests",
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: (k: string) => k === "requests" ? "Requests" : k }) }))

const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
const leader = withGrants({ id: "l1", role: "TEAM_LEADER", companyId: "c1" })
const employee = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" })
const superAdmin = { id: "s1", role: "SUPER_ADMIN", companyId: null }
/** A company's own role on the Team Leader base, deciding its team's missions (codes 49 and 67, team-wide). */
const shiftLead = { id: "h1", role: "TEAM_LEADER", companyId: "c1", grants: "49.2,67.2" }
const withoutAttendance = <T extends object>(who: T) => ({ ...who, featureAccess: { unrestricted: false, bundles: ["COMPANY_MANAGEMENT"] } })
const waiting = { tab: "mine" as const, show: "waiting" as const, search: "", personId: "", companyId: null }

describe("Decide missions", () => {
    it("is attendance's, at team or company scope, implying seeing the team's attendance, never on one's own, and not high-risk", () => {
        expect(PERMISSIONS["attendance.approve_missions"]).toEqual({
            code: 67, module: "ATTENDANCE", scopes: ["TEAM", "COMPANY"], implies: ["attendance.view_team"], notOnOwn: true,
        })
    })

    it("is held company-wide by a new company's built-in Admin, and by no other built-in role", () => {
        expect(BUILT_IN_GRANTS.ADMIN["attendance.approve_missions" as keyof typeof BUILT_IN_GRANTS.ADMIN]).toBe("COMPANY")
        expect(BUILT_IN_GRANTS.TEAM_LEADER).not.toHaveProperty("attendance.approve_missions")
        expect(BUILT_IN_GRANTS.EMPLOYEE).not.toHaveProperty("attendance.approve_missions")
    })

    it("is named in both languages", () => {
        expect(en.perm_attendance_approve_missions).toBe("Decide missions")
        expect(ar.perm_attendance_approve_missions).toBe("البت في طلبات المأمورية")
    })
})

describe("Decide missions, for the companies already there (PR 284)", () => {
    const sql = () => {
        const name = readdirSync("prisma/migrations").find(m => m.endsWith("_missions_granted"))
        expect(name).toBe("20261225000000_missions_granted")
        return readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8").split("\n").filter(line => !line.startsWith("--")).join("\n")
    }

    it("a migration gives it to the built-in Admin role alone, company-wide", () => {
        const rows = [...sql().matchAll(/\('(\w+)', '([\w.]+)', '(\w+)'\)/g)].map(([, role, permission, scope]) => [role, permission, scope])
        expect(rows).toEqual([["ADMIN", "attendance.approve_missions", "COMPANY"]])
    })

    it("leaves a role holding it already as it is, and has only the holders of a role given it reload", () => {
        const text = sql().replace(/\s+/g, " ")
        expect(text).toContain(`ON CONFLICT ("roleId", "permission") DO NOTHING RETURNING "roleId"`)
        expect(text).toContain(`UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now() WHERE "id" IN (SELECT "roleId" FROM given)`)
        expect(text).not.toMatch(/DELETE|DROP|ALTER/)
    })
})

// The allowance beside it (PR 286) has its own tests, in lib/mission-allowance.test.ts.
describe("the policy's Missions switch (decision 11)", () => {
    it("is on in every template", () => {
        for (const body of [STANDARD_OFFICE, SIX_DAY_FACTORY, MEASURE_ONLY]) expect(body.missions.enabled).toBe(true)
    })

    it("reads as on in a version saved before it, so nothing is migrated", () => {
        const saved: Record<string, unknown> = { ...STANDARD_OFFICE }
        delete saved.missions
        expect(policyBodySchema.parse(saved).missions.enabled).toBe(true)
    })

    it("keeps off once turned off", () => {
        expect(policyBodySchema.parse({ ...STANDARD_OFFICE, missions: { enabled: false } }).missions.enabled).toBe(false)
    })

    it("is in the policy dialog's own Missions section, and the policy card says whether they're on", () => {
        const dialog = readFileSync("components/attendance-policy/PolicyDialog.tsx", "utf8")
        const form = readFileSync("components/attendance-policy/policy-form.ts", "utf8")
        const panel = readFileSync("components/AttendancePolicyPanel.tsx", "utf8")
        expect(dialog).toContain("t('attendance_missions')")
        expect(dialog).toContain("t('attendance_missions_on')")
        expect(dialog).toContain("setMissions({ enabled: e.target.checked })")
        // No days back since §7.20: a mission is asked for from the payroll month's first day, as every request is.
        expect(form).toContain("missions: { enabled: form.missions.enabled, allowance },")
        expect(panel).toContain("shown.body.missions.enabled")
        expect(en.attendance_missions_on).toBe("Employees can ask for missions")
        expect(ar.attendance_missions_on).toBe("يمكن للموظفين طلب المأموريات")
    })

    it("round-trips through the policy form", async () => {
        const { formFromBody, bodyFromForm } = await import("@/components/attendance-policy/policy-form")
        const off = { ...STANDARD_OFFICE, missions: { ...STANDARD_OFFICE.missions, enabled: false } }
        const out = bodyFromForm(formFromBody(off), off)
        expect(out.ok && out.body.missions.enabled).toBe(false)
    })
})

describe("a mission's dates", () => {
    const today = "2026-11-14"
    // From a year back: these rules aren't about how far back (LATER_CHANGES_PLAN.md §7.20).
    const days = missionDays("2025-11-14", today)

    it("by days, run from its first date to its last, both kept", () => {
        expect(missionSpan({ kind: "DAYS", startDate: "2026-11-16", endDate: "2026-11-18" }, days)).toEqual({ startDate: "2026-11-16", endDate: "2026-11-18", hoursPart: null })
        expect(missionSpan({ kind: "DAYS", startDate: "2026-11-16", endDate: "2026-11-16" }, days)).toEqual({ startDate: "2026-11-16", endDate: "2026-11-16", hoursPart: null })
    })

    it("by hours, are one date with its part of the day", () => {
        expect(missionSpan({ kind: "HOURS", startDate: "2026-11-16", hoursPart: "TO_END" }, days)).toEqual({ startDate: "2026-11-16", endDate: "2026-11-16", hoursPart: "TO_END" })
        expect(missionSpan({ kind: "HOURS", startDate: "2026-11-16", endDate: "2026-11-16", hoursPart: "FROM_START" }, days)).toEqual({ startDate: "2026-11-16", endDate: "2026-11-16", hoursPart: "FROM_START" })
    })

    it("are refused out of order, by hours across two dates or without its part, or by days with one", () => {
        for (const ask of [
            { kind: "DAYS" as const, startDate: "2026-11-18", endDate: "2026-11-16" },
            { kind: "DAYS" as const, startDate: "2026-11-16" },
            { kind: "DAYS" as const, startDate: "2026-11-16", endDate: "2026-11-17", hoursPart: "TO_END" as const },
            { kind: "HOURS" as const, startDate: "2026-11-16", endDate: "2026-11-17", hoursPart: "TO_END" as const },
            { kind: "HOURS" as const, startDate: "2026-11-16" },
            { kind: "DAYS" as const, startDate: "2026-02-30", endDate: "2026-03-01" },
        ]) expect(missionSpan(ask, days), JSON.stringify(ask)).toEqual({ refused: "MISSION_DATES_INVALID" })
    })

    it(`by days are ${MISSION_MAX_DAYS} days at most`, () => {
        expect(missionSpan({ kind: "DAYS", startDate: "2026-11-01", endDate: "2027-01-29" }, days)).toMatchObject({ endDate: "2027-01-29" })
        expect(missionSpan({ kind: "DAYS", startDate: "2026-11-01", endDate: "2027-01-30" }, days)).toEqual({ refused: "MISSION_TOO_LONG" })
    })

    it("are within the days that may be asked for: from the first day a request may be, and a year ahead", () => {
        const week = missionDays("2026-11-07", today)
        expect(missionSpan({ kind: "HOURS", startDate: "2026-11-07", hoursPart: "TO_END" }, week)).toMatchObject({ startDate: "2026-11-07" })
        expect(missionSpan({ kind: "HOURS", startDate: "2026-11-06", hoursPart: "TO_END" }, week)).toEqual({ refused: "MISSION_OUT_OF_RANGE" })
        expect(missionSpan({ kind: "DAYS", startDate: "2026-11-06", endDate: "2026-11-08" }, week)).toEqual({ refused: "MISSION_OUT_OF_RANGE" })
        expect(missionSpan({ kind: "DAYS", startDate: "2027-11-10", endDate: "2027-11-14" }, week)).toMatchObject({ endDate: "2027-11-14" })
        expect(missionSpan({ kind: "DAYS", startDate: "2027-11-10", endDate: "2027-11-15" }, week)).toEqual({ refused: "MISSION_OUT_OF_RANGE" })
        // From the first day given, whatever it is.
        expect(missionSpan({ kind: "HOURS", startDate: "2025-11-14", hoursPart: "TO_END" }, days)).toMatchObject({ startDate: "2025-11-14" })
        expect(missionSpan({ kind: "HOURS", startDate: "2025-11-13", hoursPart: "TO_END" }, days)).toEqual({ refused: "MISSION_OUT_OF_RANGE" })
    })

    it("are each date of it, in order, across a month's end", () => {
        expect(datesOf("2026-11-29", "2026-12-02")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"])
        expect(datesOf("2026-11-29", "2026-11-29")).toEqual(["2026-11-29"])
    })

    it("name its kind as the page shows it", () => {
        expect(missionKey("DAYS", null)).toBe("DAYS")
        expect(missionKey("HOURS", "TO_END")).toBe("TO_END")
        expect(missionKey("HOURS", "FROM_START")).toBe("FROM_START")
    })
})

describe("a mission's scans so far, for whoever decides it", () => {
    it("are each day that has any, in order, with that day's scans as the clock read them", () => {
        const at = (local: string) => ({ punchAtLocal: new Date(`${local}:00Z`) })
        expect(missionScans([at("2026-11-17T17:40"), at("2026-11-16T09:02"), at("2026-11-16T13:15"), at("2026-11-17T08:55")])).toEqual([
            { date: "2026-11-16", times: ["09:02", "13:15"] },
            { date: "2026-11-17", times: ["08:55", "17:40"] },
        ])
        expect(missionScans([])).toEqual([])
    })
})

describe("missions on Mine", () => {
    it("are one's own in their company, waiting or ended: approved, rejected, withdrawn or cancelled", () => {
        expect(missionWhere(employee, waiting)).toEqual({ companyId: "c1", userId: "e1", status: "PENDING" })
        expect(missionWhere(admin, { ...waiting, show: "done" })).toEqual({ companyId: "c1", userId: "a1", status: { in: ["APPROVED", "REJECTED", "WITHDRAWN", "CANCELLED"] } })
    })

    it("aren't the Super Admin's, nor anyone's in a company without Attendance", () => {
        expect(missionWhere(superAdmin, waiting)).toBeNull()
        expect(missionWhere(withoutAttendance(employee), waiting)).toBeNull()
    })
})

describe("missions on To review", () => {
    const review = { ...waiting, tab: "review" as const }

    it("are everyone else's in the company, for whoever decides the company's", () => {
        expect(missionWhere(admin, review)).toEqual({ companyId: "c1", userId: { not: "a1" }, status: "PENDING" })
    })

    it("are their team's, for a role that decides its team's", () => {
        expect(missionWhere(shiftLead, review)).toEqual({
            companyId: "c1", userId: { not: "h1" }, status: "PENDING", AND: [{ user: { OR: [{ teamLeaderId: "h1" }, { id: "h1" }] } }],
        })
    })

    it("aren't there for whoever doesn't decide them, nor in a company without Attendance", () => {
        expect(missionWhere(employee, review)).toBeNull()
        expect(missionWhere(leader, review)).toBeNull()
        expect(missionWhere(withoutAttendance(admin), review)).toBeNull()
    })

    it("are the picked company's for the Super Admin, or every company's, narrowed to a person and the reason's words", () => {
        expect(missionWhere(superAdmin, { ...review, companyId: "c2" })).toEqual({ companyId: "c2", status: "PENDING" })
        expect(missionWhere(shiftLead, { ...review, personId: "x9", search: "client" })).toMatchObject({
            reason: { contains: "client", mode: "insensitive" },
            AND: [{ user: { OR: [{ teamLeaderId: "h1" }, { id: "h1" }] } }, { userId: "x9" }],
        })
    })
})

describe("a mission's row", () => {
    const asked = new Date("2026-11-10T09:00:00Z")
    const decided = new Date("2026-11-11T10:00:00Z")
    const mission = (fields: object = {}) => ({
        id: "m1", companyId: "c1", userId: "e2", kind: "DAYS", startDate: new Date("2026-11-16T00:00:00Z"), endDate: new Date("2026-11-18T00:00:00Z"),
        hoursPart: null, taskTitle: "Site survey", reason: "Client visit in Alexandria", status: "PENDING", createdAt: asked, updatedAt: asked,
        rejectionReason: null, user: { firstName: "Mona", lastName: "Adel", teamLeaderId: "h1" }, ...fields,
    })
    const scans = [{ date: "2026-11-16", times: ["09:02"] }]

    it("says its kind, dates, task and why, in order of when it was asked", () => {
        expect(missionRow(admin, mission(), scans)).toMatchObject({
            kind: "mission", id: "m1", who: { id: "e2", name: "Mona Adel" }, what: "DAYS", detail: "Client visit in Alexandria", status: "PENDING",
            asked: asked.toISOString(), sortAt: asked.toISOString(), finished: null, mayDelete: false,
            mission: { kind: "DAYS", from: "2026-11-16", to: "2026-11-18", task: "Site survey", rejectionReason: null, scans },
        })
        expect(missionRow(admin, mission({ kind: "HOURS", endDate: new Date("2026-11-16T00:00:00Z"), hoursPart: "FROM_START", taskTitle: null }), scans).mission)
            .toMatchObject({ kind: "FROM_START", from: "2026-11-16", to: "2026-11-16", task: null })
    })

    it("may be decided while it waits by whoever decides the asker's, never by the asker, with the scans so far for them alone", () => {
        expect(missionRow(admin, mission(), scans).mayDecide).toBe(true)
        expect(missionRow(shiftLead, mission(), scans).mayDecide).toBe(true)
        expect(missionRow(superAdmin, mission(), scans).mayDecide).toBe(true)
        expect(missionRow(shiftLead, mission({ user: { firstName: "Sami", lastName: "Nabil", teamLeaderId: "h2" } }), scans).mayDecide).toBe(false)
        expect(missionRow(employee, mission(), scans).mayDecide).toBe(false)
        expect(missionRow(admin, mission({ status: "APPROVED", updatedAt: decided }), scans).mayDecide).toBe(false)
        expect(missionRow(admin, mission({ userId: "a1" }), scans).mayDecide).toBe(false)
        expect(missionRow(employee, mission({ userId: "e1" }), scans).mission?.scans).toBeNull()
    })

    it("may be withdrawn by whoever asked, while it waits", () => {
        expect(missionRow(employee, mission({ userId: "e1" }), null).mayWithdraw).toBe(true)
        expect(missionRow(employee, mission({ userId: "e1", status: "APPROVED", updatedAt: decided }), null).mayWithdraw).toBe(false)
        expect(missionRow(admin, mission(), scans).mayWithdraw).toBe(false)
    })

    it("once ended, is in order of when, with why it was rejected", () => {
        expect(missionRow(admin, mission({ status: "REJECTED", rejectionReason: "Not this week", updatedAt: decided }), null)).toMatchObject({
            finished: decided.toISOString(), sortAt: decided.toISOString(), mission: { rejectionReason: "Not this week" },
        })
    })

    it("once approved, may be cancelled by whoever decides the asker's, never by the asker (decision 25, PR 285)", () => {
        const approved = (fields: object = {}) => mission({ status: "APPROVED", updatedAt: decided, ...fields })
        expect(missionRow(admin, approved(), null).mayCancel).toBe(true)
        expect(missionRow(shiftLead, approved(), null).mayCancel).toBe(true)
        expect(missionRow(superAdmin, approved(), null).mayCancel).toBe(true)
        expect(missionRow(shiftLead, approved({ user: { firstName: "Sami", lastName: "Nabil", teamLeaderId: "h2" } }), null).mayCancel).toBe(false)
        expect(missionRow(leader, approved(), null).mayCancel).toBe(false)
        expect(missionRow(employee, approved({ userId: "e1" }), null).mayCancel).toBe(false)
        expect(missionRow(admin, approved({ userId: "a1" }), null).mayCancel).toBe(false)
        // Only an approved one: one waiting is rejected or withdrawn instead.
        for (const status of ["PENDING", "REJECTED", "WITHDRAWN", "CANCELLED"]) expect(missionRow(admin, mission({ status }), null).mayCancel, status).toBe(false)
    })

    it("once cancelled, is in order of when, with why", () => {
        expect(missionRow(employee, mission({ userId: "e1", status: "CANCELLED", cancelReason: "Trip called off", updatedAt: decided }), null)).toMatchObject({
            status: "CANCELLED", finished: decided.toISOString(), sortAt: decided.toISOString(), mayWithdraw: false,
            mission: { cancelReason: "Trip called off", rejectionReason: null },
        })
        expect(missionRow(admin, mission(), null).mission?.cancelReason).toBeNull()
    })
})

describe("the Requests page", () => {
    const row = (fields: Partial<FeedRow> = {}): FeedRow => ({
        kind: "mission", id: "m1", who: { id: "e2", name: "Mona Adel" }, what: "DAYS", detail: "Client visit in Alexandria",
        asked: "2026-11-10T09:00:00.000Z", started: null, finished: null, status: "PENDING", sortAt: "2026-11-10T09:00:00.000Z",
        mayDecide: false, mayDelete: false,
        mission: { kind: "DAYS", from: "2026-11-16", to: "2026-11-18", task: "Site survey", rejectionReason: null, cancelReason: null, scans: null },
        ...fields,
    })
    async function page(props: Record<string, unknown> = {}) {
        const { default: RequestsClient } = await import("@/app/(dashboard)/dashboard/requests/RequestsClient")
        return renderToStaticMarkup(h(RequestsClient, {
            rows: [row()], total: 1, page: 1, totalPages: 1, kinds: ["internal", "permission", "mission"],
            tabs: { mine: true, review: true }, tab: "review", show: "waiting", superAdmin: false,
            ...props,
        } as any))
    }
    const client = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
    const dialogs = readFileSync("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx", "utf8")
    const server = readFileSync("app/(dashboard)/dashboard/requests/page.tsx", "utf8")

    it("lists missions after permission hours in its kind filter", () => {
        expect(REQUEST_KINDS.indexOf("mission")).toBe(REQUEST_KINDS.indexOf("permission") + 1)
        expect(client).toContain("mission: 'requests_kind_mission'")
    })

    it("reads a mission as any request: its kind, dates, who asked and its status", async () => {
        const html = await page()
        expect(html).toContain("requests_mission_days")
        expect(html).toContain("16 Nov 2026")
        expect(html).toContain("18 Nov 2026")
        expect(html).toContain("Mona Adel")
        expect(html).toContain("requests_kind_mission")
        expect(html).toContain("ui-badge ui-badge-waiting")
        expect(await page({ rows: [row({ what: "TO_END", mission: { kind: "TO_END", from: "2026-11-16", to: "2026-11-16", task: null, rejectionReason: null, cancelReason: null, scans: null } })] }))
            .toContain("requests_mission_to_end")
    })

    it("is approved or rejected under To review by whoever may decide it, through its own route", async () => {
        expect(await page()).not.toContain("approve_button")
        const html = await page({ rows: [row({ mayDecide: true })] })
        expect(html).toMatch(/<button[^>]*>.*approve_button/)
        expect(html).toMatch(/<button[^>]*>.*reject_button/)
        expect(dialogs).toContain("mission: '/api/attendance/missions'")
        expect(client).toContain("'requests_mission_reject_question'")
    })

    it("once ended, is Approved, Rejected or Withdrawn", async () => {
        expect(await page({ rows: [row({ status: "APPROVED" })], show: "done" })).toContain("ui-badge ui-badge-good")
        expect(await page({ rows: [row({ status: "REJECTED" })], show: "done" })).toContain("ui-badge ui-badge-problem")
        const withdrawn = await page({ rows: [row({ status: "WITHDRAWN" })], show: "done" })
        expect(withdrawn).toContain("ui-badge ui-badge-neutral")
        expect(withdrawn).toContain("status_withdrawn")
    })

    it("once approved, is cancelled from its row's More actions, with a reason, through its own route (PR 285)", () => {
        expect(client).toContain("r.mayCancel")
        expect(client).toContain("label: t('requests_mission_cancel')")
        expect(client).toContain("<CancelMission")
        expect(dialogs).toContain("export function CancelMission(")
        expect(dialogs).toContain("fetch(`${ATTENDANCE_API.mission}/${request.id}/cancel`, {")
        expect(dialogs).toContain("MISSION_NOT_APPROVED: 'requests_mission_not_approved'")
        // It needs its reason, said under the field.
        expect(dialogs).toContain("t('requests_mission_cancel_reason_missing')")
    })

    it("once cancelled, is Cancelled, in the problem badge's colours, not Withdrawn: it isn't the asker's doing", async () => {
        const cancelled = row({ status: "CANCELLED", finished: "2026-11-12T10:00:00.000Z", mission: { kind: "DAYS", from: "2026-11-16", to: "2026-11-18", task: null, rejectionReason: null, cancelReason: "Trip called off", scans: null } })
        const html = await page({ rows: [cancelled], show: "done" })
        expect(html).toContain("ui-badge ui-badge-problem")
        expect(html).toContain("requests_mission_cancelled")
        expect(html).not.toContain("status_withdrawn")
        expect(client).toContain("'requests_mission_cancelled_on'")
        expect(client).toContain("t('requests_mission_cancel_reason')")
    })

    it("shows whoever decides it the task, or No task, and the scans so far, or that there are none yet", () => {
        expect(client).toContain("t('requests_mission_task')")
        expect(client).toContain("t('requests_mission_no_task')")
        expect(client).toContain("t('requests_mission_scans')")
        expect(client).toContain("t('requests_mission_no_scans')")
        expect(client).toContain("t('requests_mission_part')")
    })

    it("is withdrawn by whoever asked, while it waits, with its own words", () => {
        expect(client).toContain("'requests_mission_withdraw_hint'")
        expect(dialogs).toContain("fetch(`${ATTENDANCE_API[request.kind as AttendanceKind]}/${request.id}`, { method: 'DELETE' })")
    })

    it("asks for one from New request while missions are on: the kind, dates or date and part of the day, an open task and why", () => {
        expect(server).toContain("MissionRequestService.missionsOnToday(")
        expect(client).toContain("mayAskMission")
        expect(client).toContain("<AskMission")
        expect(dialogs).toContain("export function AskMission(")
        expect(dialogs).toContain("fetch('/api/attendance/missions', {")
        expect(dialogs).toContain("/api/attendance/missions/tasks")
        expect(dialogs).toContain("<DateRangePicker")
        expect(dialogs).toContain("t('requests_mission_no_task')")
        expect(dialogs).toContain("maxLength={500}")
        for (const code of ["MISSIONS_OFF", "MISSION_DATES_INVALID", "MISSION_TOO_LONG", "MISSION_OUT_OF_RANGE", "MISSION_OVERLAPS", "MISSION_OVERLAPS_DAY_OFF", "MISSION_TASK_NOT_OPEN"]) {
            expect(dialogs, code).toContain(code)
        }
    })

    it("opens on a mission named in its address, as any request", () => {
        expect(server).toContain("prisma.missionRequest.findUnique({ where: { id: searchParams.highlight }")
    })

    it("has no styles typed in", async () => {
        expect(await page({ rows: [row({ mayDecide: true }), row({ id: "m2", mayWithdraw: true })], tab: "mine" })).not.toContain("style=")
    })
})

describe("the notice of a decision", () => {
    it("opens the Requests page on the mission", () => {
        expect(attendanceNoticeTarget("ATTENDANCE_REQUEST", "m1", "notice_att_mission_approved")).toBe("/dashboard/requests?kind=mission&highlight=m1")
        expect(attendanceNoticeTarget("ATTENDANCE_REQUEST", "m1", "notice_att_mission_rejected")).toBe("/dashboard/requests?kind=mission&highlight=m1")
        expect(attendanceNoticeTarget("ATTENDANCE_REQUEST", "m1", "notice_att_mission_cancelled")).toBe("/dashboard/requests?kind=mission&highlight=m1")
    })

    it("of a cancellation names its day or its dates, and why (PR 285)", () => {
        expect(en.notice_att_mission_cancelled).toBe("Your mission {when} has been cancelled.{reason}")
        expect(ar.notice_att_mission_cancelled).toBe("تم إلغاء المأمورية {when}.{reason}")
    })

    it("names its day or its dates, and the reason if there is one, in both languages", () => {
        expect(en.notice_att_mission_approved).toBe("Your mission {when} has been approved.")
        expect(en.notice_att_mission_rejected).toBe("Your mission {when} was not approved.{reason}")
        expect(ar.notice_att_mission_approved).toBe("تمت الموافقة على المأمورية {when}.")
        expect(ar.notice_att_mission_rejected).toBe("لم تتم الموافقة على المأمورية {when}.{reason}")
        expect([en.notice_mission_day, en.notice_mission_days]).toEqual(["on {date}", "from {from} to {to}"])
        expect([ar.notice_mission_day, ar.notice_mission_days]).toEqual(["يوم {date}", "من {from} إلى {to}"])
    })
})

describe("payroll's window", () => {
    it("counts the missions waiting, opening To review on missions", async () => {
        const { UndecidedRequests } = await import("@/app/(dashboard)/dashboard/payroll/SettleFirst")
        const html = renderToStaticMarkup(h(UndecidedRequests, { requests: { permissions: 0, missing: 0, overtime: 0, missions: 2 } }))
        expect(html).toContain("payroll_undecided_missions")
        expect(html).toContain("/dashboard/requests?tab=review&amp;kind=mission&amp;show=waiting")
        expect(en.payroll_undecided_missions).toBe("Missions")
        expect(ar.payroll_undecided_missions).toBe("مأموريات")
    })
})

describe("its words", () => {
    const keys = [
        "requests_kind_mission", "requests_mission_days", "requests_mission_to_end", "requests_mission_from_start",
        "requests_mission_kind", "requests_mission_by_days", "requests_mission_by_hours", "requests_mission_part",
        "requests_mission_task", "requests_mission_no_task", "requests_mission_scans", "requests_mission_no_scans",
        "requests_mission_reason_placeholder", "requests_mission_reason_missing", "requests_mission_dates_missing",
        "requests_mission_reject_question", "requests_mission_reject_placeholder", "requests_mission_withdraw_hint",
        "requests_missions_off", "requests_mission_dates_invalid", "requests_mission_too_long", "requests_mission_out_of_range",
        "requests_mission_overlaps", "requests_mission_overlaps_day_off", "requests_mission_task_not_open",
        "requests_day_off_overlaps_mission",
        "attendance_missions", "attendance_missions_on", "attendance_missions_line",
        "audit_action_REQUEST_ATTENDANCE_MISSION", "audit_action_APPROVE_ATTENDANCE_MISSION", "audit_action_REJECT_ATTENDANCE_MISSION", "audit_action_WITHDRAW_ATTENDANCE_MISSION",
        // Cancelling an approved one (PR 285).
        "requests_mission_cancel", "requests_mission_cancel_title", "requests_mission_cancel_question", "requests_mission_cancel_hint",
        "requests_mission_cancel_reason", "requests_mission_cancel_placeholder", "requests_mission_cancel_reason_missing", "requests_mission_keep",
        "requests_mission_cancelled", "requests_mission_cancelled_on", "requests_mission_cancelled_done", "requests_mission_not_approved",
        "audit_action_CANCEL_ATTENDANCE_MISSION", "notice_att_mission_cancelled",
    ]

    it("are in both languages, and the typed parts the same in each", () => {
        const enw = en as Record<string, string>, arw = ar as Record<string, string>
        for (const key of keys) {
            expect(enw[key], key).toBeTruthy()
            expect(arw[key], key).toBeTruthy()
            const slots = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
            expect(slots(arw[key]), key).toEqual(slots(enw[key]))
        }
    })

    it("call a mission مأمورية in Arabic", () => {
        expect(ar.requests_kind_mission).toBe("مأموريات")
        expect(ar.requests_mission_days).toBe("مأمورية بالأيام")
        expect(ar.requests_mission_to_end).toBe("مأمورية حتى نهاية اليوم")
        expect(ar.requests_mission_from_start).toBe("مأمورية من بداية اليوم")
    })
})
