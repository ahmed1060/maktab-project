import { describe, it, expect, vi } from "vitest"
import { state, prismaMock, ACTOR_NAMES, as, url, withBody, fieldsWritten, type ActorName } from "./employee-access.harness"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Who may manage employees today — recorded, not reasoned about.
 *
 * Same method as the payroll, day-off and salary records, over the employee
 * routes: listing, creating, editing, deleting, account status, employment
 * history and ending a contract, team assignment and password resets. The real
 * routes and the real UserService run as every kind of caller; the services an
 * employee change calls into afterwards are no-ops.
 *
 * Editing is where most of the decisions are, and they are per field: a
 * request can succeed while some of its fields are silently ignored. So each
 * edit records the status *and which fields were actually written*.
 *
 * Every value here was observed by running the code before employees moved to
 * can(), and checked against a reading of it. Three observed behaviours are
 * recorded as they are and are not what the roles plan would choose — Part A
 * changes nobody's access, so fixing them is deliberate, separate work:
 *
 * - An Admin may change their own salary (the field rule reads the caller's
 *   role, not whose record it is).
 * - (Fixed since recording: editing or deleting someone in another company was
 *   refused with an unmapped 500. The routes now answer 403, and the cases
 *   below say so. Nothing was ever written either way.)
 * - Two different "status" paths: POST /users/[id]/status is Super Admin only,
 *   while the status field of an edit is open to Admins.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))
vi.mock("@/lib/services/salary-history.service", () => ({ SalaryHistoryService: { record: async () => {} } }))
vi.mock("@/lib/services/salary.service", () => ({ SalaryService: { ensureRecordExists: async () => {} } }))
vi.mock("@/lib/services/employment.service", () => ({ EmploymentService: { recordStatusChange: async () => {}, record: async () => ({ id: "ev" }), history: async () => [], timelineForMonth: async () => [] } }))
vi.mock("@/lib/services/settlement.service", () => ({ SettlementService: { preview: async () => ({}), settleAndEnd: async () => ({ event: {}, settlement: {}, debt: null, preview: {} }) } }))

type Outcome = [status: number, written?: string]
type Case = { name: string; run: () => Promise<Response>; expected: Record<ActorName, Outcome> }

const users = () => import("@/app/api/users/route")
const put = (body: unknown) => async () => (await users()).PUT(withBody("PUT", "/api/users", body))

/** Allowed for managers of c1, refused (403) for everyone else, same fields written. */
function c1Managers(written: string, others: Partial<Record<ActorName, Outcome>> = {}): Record<ActorName, Outcome> {
    return {
        superAdmin: [200, written], admin: [200, written],
        otherAdmin: [403, ""], leader: [403, ""], employee: [403, ""],
        ...others,
    }
}

const EDITS: Case[] = [
    {
        name: "editing an ordinary field of an employee",
        run: put({ id: "emp", gender: "FEMALE" }),
        expected: c1Managers("gender", { employee: [200, "gender"] }),   // it is the employee's own record
    },
    {
        name: "editing an ordinary field of someone in another company",
        run: put({ id: "other", gender: "FEMALE" }),
        expected: { superAdmin: [200, "gender"], admin: [403, ""], otherAdmin: [200, "gender"], leader: [403, ""], employee: [403, ""] },
    },
    {
        name: "editing an ordinary field of a teamless employee",
        run: put({ id: "loner", gender: "FEMALE" }),
        expected: c1Managers("gender"),
    },
    {
        name: "changing an employee's salary",
        run: put({ id: "emp", salary: 5000 }),
        // An employee editing their own record: accepted, salary ignored.
        expected: c1Managers("salary", { employee: [200, ""] }),
    },
    {
        name: "an Admin's salary",
        run: put({ id: "admin", salary: 5000 }),
        // Fixed in Part B: nobody sets their own pay (ROLES_PLAN.md §4.2,
        // rule 5) — accepted, salary ignored, as for an employee. Recorded
        // first as the Admin changing their own.
        expected: c1Managers("salary", { admin: [200, ""] }),
    },
    {
        name: "an Admin's own leave allowance",
        run: put({ id: "admin", baseDayOffCredit: 30 }),
        // Nobody sets their own allowance either.
        expected: c1Managers("baseDayOffCredit,dayOffCredit", { admin: [200, ""] }),
    },
    {
        name: "changing a leave balance",
        run: put({ id: "emp", dayOffCredit: 3 }),
        expected: c1Managers("dayOffCredit", { employee: [200, ""] }),
    },
    {
        name: "changing a yearly leave allowance",
        run: put({ id: "emp", baseDayOffCredit: 21 }),
        expected: c1Managers("baseDayOffCredit,dayOffCredit", { employee: [200, ""] }),
    },
    {
        name: "changing account status through an edit",
        run: put({ id: "emp", status: "SUSPENDED" }),
        expected: c1Managers("status", { employee: [200, ""] }),
    },
    {
        name: "making an employee a Team Leader",
        run: put({ id: "loner", role: "TEAM_LEADER" }),
        // role and the role that sets it, written together since roles became
        // data — who may do it is unchanged.
        expected: c1Managers("role,roleId"),
    },
    {
        name: "making an employee an Admin",
        run: put({ id: "loner", role: "ADMIN" }),
        expected: c1Managers("role,roleId", { admin: [403, ""] }),   // Super Admin only
    },
    {
        name: "putting an employee on a team",
        run: put({ id: "loner", teamLeaderId: "tl" }),
        expected: c1Managers("teamLeaderId"),
    },
    {
        name: "moving an employee to another company",
        run: put({ id: "emp", companyId: "c2" }),
        // Super Admin only; for an Admin the field is ignored. A new company
        // means that company's role, so role and roleId are written with it.
        expected: c1Managers("companyId,role,roleId,teamLeaderId", { admin: [200, ""], employee: [200, ""] }),
    },
]

const create = (role: string) => async () => (await users()).POST(withBody("POST", "/api/users", {
    firstName: "New", lastName: "Person", email: `new-${role}@x.co`, password: "a-long-password-123",
    role, gender: "MALE", companyId: "c1",
}))
const del = (id: string) => async () => (await users()).DELETE(new Request(url(`/api/users?id=${id}`), { method: "DELETE" }))
const SOFT_DELETE = "avatar,email,firstName,lastName,status,username"

const OTHERS: Case[] = [
    {
        name: "listing employees",
        run: async () => (await users()).GET(new Request(url("/api/users"))),
        // Scoped by company, and for a Team Leader by team — recorded in
        // lib/services/user-query.test.ts. Here: who is let in at all.
        expected: { superAdmin: [200], admin: [200], otherAdmin: [200], leader: [200], employee: [403] },
    },
    {
        name: "creating an employee",
        run: create("EMPLOYEE"),
        expected: { superAdmin: [201], admin: [201], otherAdmin: [201], leader: [403], employee: [403] },
    },
    {
        name: "creating an Admin",
        run: create("ADMIN"),
        expected: { superAdmin: [201], admin: [403], otherAdmin: [403], leader: [403], employee: [403] },
    },
    { name: "deleting an employee", run: del("emp"), expected: c1Managers(SOFT_DELETE) },
    {
        name: "deleting another Admin",
        run: del("admin1b"),
        expected: c1Managers(SOFT_DELETE, { admin: [403, ""] }),   // Super Admin only
    },
    {
        name: "deleting someone in another company",
        run: del("other"),
        expected: { superAdmin: [200, SOFT_DELETE], admin: [403, ""], otherAdmin: [200, SOFT_DELETE], leader: [403, ""], employee: [403, ""] },
    },
    {
        name: "the account status route",
        run: async () => (await import("@/app/api/users/[id]/status/route")).POST(withBody("POST", "/api/users/emp/status", { status: "SUSPENDED" }), { params: { id: "emp" } }),
        expected: { superAdmin: [200], admin: [403], otherAdmin: [403], leader: [403], employee: [403] },
    },
    {
        name: "an employee's employment history",
        run: async () => (await import("@/app/api/users/[id]/employment/route")).GET(new Request(url("/api/users/emp/employment")), { params: { id: "emp" } }),
        expected: c1Managers("", { otherAdmin: [403] }),
    },
    {
        name: "a settlement preview for ending a contract",
        run: async () => (await import("@/app/api/users/[id]/employment/route")).GET(new Request(url("/api/users/emp/employment?lastWorkingDay=2026-10-01")), { params: { id: "emp" } }),
        expected: c1Managers("", { otherAdmin: [403] }),
    },
    {
        name: "assigning people to a team",
        run: async () => (await import("@/app/api/users/team/route")).PATCH(withBody("PATCH", "/api/users/team", { userIds: ["loner"], teamLeaderId: "tl" })),
        expected: c1Managers("teamLeaderId", { otherAdmin: [403, ""] }),
    },
    {
        name: "resetting an employee's password",
        run: async () => {
            const { UserService } = await import("@/lib/services/user.service")
            // Checks the acting Admin's own password with bcrypt; no access
            // decision is made inside it, so it is stubbed for the record.
            vi.spyOn(UserService, "resetPassword").mockResolvedValue({} as any)
            return (await import("@/app/api/users/[id]/reset-password/route")).POST(withBody("POST", "/api/users/emp/reset-password", { confirmPassword: "x" }), { params: { id: "emp" } })
        },
        expected: c1Managers("", { otherAdmin: [403] }),
    },
]

/**
 * Added in Part B: a company always keeps someone at work on its Admin role
 * (ROLES_PLAN.md §4.2, rule 8). c2 has one Admin, admin2; c1 has two. Before
 * the rule, every one of the refusals below was allowed — the Super Admin, or
 * admin2 acting on themselves, could leave c2 with no Admin at all.
 */
const LAST_ADMIN: Case[] = [
    {
        name: "suspending a company's only Admin",
        run: put({ id: "admin2", status: "SUSPENDED" }),
        expected: { superAdmin: [400, ""], admin: [403, ""], otherAdmin: [400, ""], leader: [403, ""], employee: [403, ""] },
    },
    {
        name: "making a company's only Admin an employee",
        run: put({ id: "admin2", role: "EMPLOYEE" }),
        expected: { superAdmin: [400, ""], admin: [403, ""], otherAdmin: [400, ""], leader: [403, ""], employee: [403, ""] },
    },
    {
        name: "moving a company's only Admin to another company",
        run: put({ id: "admin2", companyId: "c1" }),
        // For an Admin the field is ignored, so nothing moves.
        expected: { superAdmin: [400, ""], admin: [403, ""], otherAdmin: [200, ""], leader: [403, ""], employee: [403, ""] },
    },
    {
        name: "deleting a company's only Admin",
        run: async () => (await users()).DELETE(new Request(url("/api/users?id=admin2"), { method: "DELETE" })),
        // admin2 deleting themselves was already refused (400).
        expected: { superAdmin: [400, ""], admin: [403, ""], otherAdmin: [400, ""], leader: [403, ""], employee: [403, ""] },
    },
    {
        name: "suspending a company's only Admin through the status route",
        run: async () => (await import("@/app/api/users/[id]/status/route")).POST(withBody("POST", "/api/users/admin2/status", { status: "SUSPENDED" }), { params: { id: "admin2" } }),
        expected: { superAdmin: [400, ""], admin: [403, ""], otherAdmin: [403, ""], leader: [403, ""], employee: [403, ""] },
    },
    {
        name: "suspending one of a company's two Admins",
        run: put({ id: "admin1b", status: "SUSPENDED" }),
        // Another stays at work, so this is allowed.
        expected: c1Managers("status"),
    },
]

function record(cases: Case[], title: string) {
    describe(title, () => {
        for (const c of cases) {
            for (const actor of ACTOR_NAMES) {
                it(`${c.name} as ${actor}`, async () => {
                    as(actor)
                    const res = await c.run()
                    const [status, written] = c.expected[actor]
                    expect(res.status).toBe(status)
                    if (written !== undefined) expect(fieldsWritten().join(",")).toBe(written)
                })
            }
        }
    })
}

record(EDITS, "editing an employee — recorded access, per field")
record(OTHERS, "the other employee routes — recorded access")
record(LAST_ADMIN, "a company keeps an Admin — recorded access")
