import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { state, prismaMock, withBody, url } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { stepUpConfirmed } from "./permissions/test-actors"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { serializeAccess, resolveBundles } from "./features/bundles"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Who may see and correct punches (ATTENDANCE_PLAN.md §4, §14):
 * attendance.view_team to see other people's at its scope, everyone their
 * own; attendance.correct to import, add, withdraw and map employee numbers —
 * company-wide for files and numbers — and never on oneself. The company must
 * hold attendance. The service is replaced; what is checked is who reaches it.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

const reached: string[] = []
vi.mock("@/lib/services/attendance-calendar.service", () => ({ AttendanceCalendarService: { today: async (companyId: string) => companyId === "c1" ? "2026-10-01" : "2026-09-30" } }))
vi.mock("@/lib/services/attendance-punch.service", () => ({
    PUNCH_LIST_LIMIT: 2000,
    AttendancePunchService: {
        list: async (companyId: string, query: any, visible: any, limit: number) => {
            reached.push(`list:${companyId}:${visible.kind}${query.unmatched ? ":unmatched" : ""}`)
            return Array.from({ length: query.userId === "busy" ? limit : 1 }, (_, i) => ({ id: `p${i}` }))
        },
        addManual: async (companyId: string, input: any) => { reached.push(`add:${companyId}:${input.userId}`); return { id: "p-new" } },
        punchOf: async (id: string) => ({
            p1: { id: "p1", companyId: "c1", userId: "emp", user: { teamLeaderId: "tl" } },
            pOwn: { id: "pOwn", companyId: "c1", userId: "admin", user: { teamLeaderId: null } },
            pNobody: { id: "pNobody", companyId: "c1", userId: null, user: null },
            p2: { id: "p2", companyId: "c2", userId: "other", user: { teamLeaderId: null } },
        } as any)[id] ?? null,
        voidPunch: async (id: string) => { reached.push(`void:${id}`) },
        importRows: async (companyId: string, file: any, _o: any, _a: string, commit: boolean) => { reached.push(`import:${companyId}:${file.name}:${commit}`); return commit ? { importId: "i-new" } : {} },
        imports: async (companyId: string) => { reached.push(`imports:${companyId}`); return [] },
        importOf: async (id: string) => id === "i1" ? { id: "i1", companyId: "c1" } : id === "i2" ? { id: "i2", companyId: "c2" } : null,
        voidImport: async (id: string) => { reached.push(`voidImport:${id}`); return { voided: 3 } },
        codes: async (companyId: string) => { reached.push(`codes:${companyId}`); return { mapped: [], unmatched: [] } },
        mapCode: async (companyId: string, input: any) => { reached.push(`map:${companyId}:${input.code}:${input.userId}`); return { id: "m-new" } },
        codeOf: async (id: string) => id === "m1" ? { id: "m1", companyId: "c1", code: "101", userId: "emp", user: { teamLeaderId: null } } : null,
        unmapCode: async (id: string) => { reached.push(`unmap:${id}`); return { unfilled: 0 } },
        people: async () => [],
    },
}))

type Pkg = { hasCompanyManagement: boolean; hasHR: boolean; hasAttendanceTerminals?: boolean; hasAttendanceMobile?: boolean } | null
const ATTENDANCE: Pkg = { hasCompanyManagement: false, hasHR: true, hasAttendanceTerminals: true }
const HR_ONLY: Pkg = { hasCompanyManagement: false, hasHR: true }
const packages: Record<string, Pkg> = {}
const people: Record<string, { id: string; companyId: string; teamLeaderId: string | null }> = {
    emp: { id: "emp", companyId: "c1", teamLeaderId: "tl" },
    admin: { id: "admin", companyId: "c1", teamLeaderId: null },
    other: { id: "other", companyId: "c2", teamLeaderId: null },
}

beforeEach(() => {
    reached.length = 0
    packages.c1 = ATTENDANCE
    packages.c2 = ATTENDANCE
    packages.c3 = HR_ONLY
    prismaMock.company.findUnique = async ({ where }: any) => where.id in packages
        ? { id: where.id, adminSettingsEnabled: false, adminSettingsTabs: [], package: packages[where.id] } : null
    ;(prismaMock as any).user.findFirst = async ({ where }: any) => {
        const p = people[where.id]
        return p && p.companyId === where.companyId ? p : null
    }
})

function signIn(user: { id: string; role: string; companyId: string | null; grants?: Record<string, string> }, pkg: Pkg = ATTENDANCE) {
    state.session = {
        user: stepUpConfirmed({
            ...user,
            grants: user.grants ? encodeGrants(user.grants as any) : undefined,
            featureAccess: serializeAccess(resolveBundles(pkg, { isSuperAdmin: user.role === "SUPER_ADMIN" })),
        }),
    }
}
const admin = (pkg: Pkg = ATTENDANCE) => signIn({ id: "admin", role: "ADMIN", companyId: "c1", grants: BUILT_IN_GRANTS.ADMIN }, pkg)
const employee = () => signIn({ id: "emp", role: "EMPLOYEE", companyId: "c1", grants: BUILT_IN_GRANTS.EMPLOYEE })
const leader = () => signIn({ id: "tl", role: "EMPLOYEE", companyId: "c1", grants: { "attendance.view_team": "TEAM", "attendance.correct": "TEAM" } })
const superAdmin = () => signIn({ id: "sa", role: "SUPER_ADMIN", companyId: null })

const params = (id: string) => ({ params: Promise.resolve({ id }) }) as any
const list = async (query = "from=2026-10-01&to=2026-10-31") => (await import("@/app/api/attendance/punches/route")).GET(new Request(url(`/api/attendance/punches?${query}`)))
const add = async (body: unknown) => (await import("@/app/api/attendance/punches/route")).POST(withBody("POST", "/api/attendance/punches", body))
const voidPunch = async (id: string, reason = "wrong day") =>
    (await import("@/app/api/attendance/punches/[id]/void/route")).POST(withBody("POST", `/api/attendance/punches/${id}/void`, { reason }), params(id))
const imports = async (query = "") => (await import("@/app/api/attendance/imports/route")).GET(new Request(url(`/api/attendance/imports${query}`)))
const upload = async (fields: Record<string, string | File>) => {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    return (await import("@/app/api/attendance/imports/route")).POST(new Request(url("/api/attendance/imports"), { method: "POST", body: form }))
}
const csv = (name = "october.csv") => new File(["ID,Date,Time\n101,01/10/2026,08:00\n"], name, { type: "text/csv" })
const voidImport = async (id: string) =>
    (await import("@/app/api/attendance/imports/[id]/void/route")).POST(withBody("POST", `/api/attendance/imports/${id}/void`, { reason: "wrong file" }), params(id))
const codes = async (query = "") => (await import("@/app/api/attendance/codes/route")).GET(new Request(url(`/api/attendance/codes${query}`)))
const mapCode = async (body: unknown) => (await import("@/app/api/attendance/codes/route")).POST(withBody("POST", "/api/attendance/codes", body))
const unmap = async (id: string) => (await import("@/app/api/attendance/codes/[id]/route")).DELETE(withBody("DELETE", `/api/attendance/codes/${id}`, {}), params(id))

const MANUAL = { userId: "emp", at: "2026-10-01T17:10", direction: "OUT", note: "Forgot to punch out" }

describe("seeing punches", () => {
    it("shows an Admin the company's, an employee their own, and a team leader their team's", async () => {
        admin()
        expect((await list()).status).toBe(200)
        employee()
        expect((await list()).status).toBe(200)
        leader()
        expect((await list()).status).toBe(200)
        expect(reached).toEqual(["list:c1:COMPANY", "list:c1:OWN", "list:c1:TEAM"])
    })

    it("shows the punches waiting for a person only to whoever corrects the whole company", async () => {
        admin()
        expect((await list("from=2026-10-01&to=2026-10-31&unmatched=1")).status).toBe(200)
        leader()
        expect((await list("from=2026-10-01&to=2026-10-31&unmatched=1")).status).toBe(403)
        employee()
        expect((await list("from=2026-10-01&to=2026-10-31&unmatched=1")).status).toBe(403)
        expect(reached).toEqual(["list:c1:COMPANY:unmatched"])
    })

    it("asks for real dates, in order, and at most two months", async () => {
        admin()
        expect((await list("from=2026-10-31&to=2026-10-01")).status).toBe(400)
        expect((await list("from=2026-01-01&to=2026-12-31")).status).toBe(400)
        expect((await list("from=yesterday&to=2026-10-01")).status).toBe(400)
        expect(reached).toEqual([])
    })
})

describe("correcting one person's punches", () => {
    it("lets an Admin add and withdraw for somebody in their company", async () => {
        admin()
        expect((await add(MANUAL)).status).toBe(201)
        expect((await voidPunch("p1")).status).toBe(200)
        expect(reached).toEqual(["add:c1:emp", "void:p1"])
    })

    it("refuses everybody their own attendance, the Admin included", async () => {
        admin()
        expect((await add({ ...MANUAL, userId: "admin" })).status).toBe(403)
        expect((await voidPunch("pOwn")).status).toBe(403)
        expect(reached).toEqual([])
    })

    it("lets a team leader with TEAM scope correct their team, not the punches waiting for a person", async () => {
        leader()
        expect((await add(MANUAL)).status).toBe(201)
        expect((await voidPunch("p1")).status).toBe(200)
        expect((await voidPunch("pNobody")).status).toBe(403)
        expect(reached).toEqual(["add:c1:emp", "void:p1"])
    })

    it("refuses an employee, and anybody reaching into another company", async () => {
        employee()
        expect((await add({ ...MANUAL, userId: "admin" })).status).toBe(403)
        expect((await voidPunch("p1")).status).toBe(403)
        admin()
        expect((await add({ ...MANUAL, userId: "other" })).status).toBe(404)
        expect((await voidPunch("p2")).status).toBe(404)
        expect((await voidPunch("nope")).status).toBe(404)
        expect(reached).toEqual([])
    })
})

describe("files and employee numbers", () => {
    it("are an Admin's, company-wide: preview, import, list, withdraw, map, unmap", async () => {
        admin()
        expect((await upload({ file: csv() })).status).toBe(200)
        expect((await upload({ file: csv(), commit: "true" })).status).toBe(201)
        expect((await imports()).status).toBe(200)
        expect((await voidImport("i1")).status).toBe(200)
        expect((await codes()).status).toBe(200)
        expect((await mapCode({ code: "101", userId: "emp" })).status).toBe(201)
        expect((await unmap("m1")).status).toBe(200)
        expect(reached).toEqual(["import:c1:october.csv:false", "import:c1:october.csv:true", "imports:c1", "voidImport:i1", "codes:c1", "map:c1:101:emp", "unmap:m1"])
    })

    it("are not a team leader's, whose correcting reaches only their team", async () => {
        leader()
        expect((await upload({ file: csv() })).status).toBe(403)
        expect((await imports()).status).toBe(403)
        expect((await voidImport("i1")).status).toBe(403)
        expect((await codes()).status).toBe(403)
        expect((await mapCode({ code: "101", userId: "emp" })).status).toBe(403)
        expect(reached).toEqual([])
    })

    it("never map a number to oneself, and stay in one's own company", async () => {
        admin()
        expect((await mapCode({ code: "7", userId: "admin" })).status).toBe(403)
        expect((await mapCode({ code: "7", userId: "other" })).status).toBe(404)
        expect((await voidImport("i2")).status).toBe(404)
        expect(reached).toEqual([])
    })

    it("take a spreadsheet only: .xlsx or .csv, and a column override that is the right shape", async () => {
        admin()
        expect((await upload({ file: csv("october.pdf") })).status).toBe(400)
        expect((await upload({ file: csv(), columns: "{not json" })).status).toBe(400)
        expect((await upload({ file: csv(), columns: JSON.stringify({ code: -1, date: 1, time: null, direction: null }) })).status).toBe(400)
        expect(reached).toEqual([])
    })
})

describe("the company must hold attendance", () => {
    it("keeps a company without the add-on out, for its own people and the Super Admin alike", async () => {
        admin(HR_ONLY)
        expect((await list()).status).toBe(403)
        superAdmin()
        expect((await list("companyId=c3&from=2026-10-01&to=2026-10-31")).status).toBe(404)
        expect((await list("companyId=c1&from=2026-10-01&to=2026-10-31")).status).toBe(200)
        expect((await list()).status).toBe(400)
        expect(reached).toEqual(["list:c1:COMPANY"])
    })
})

describe("the screen's dates (review on #12)", () => {
    it("come from the company's calendar, not the viewer's device", async () => {
        admin()
        const res = await (await import("@/app/api/attendance/people/route")).GET(new Request(url("/api/attendance/people")))
        expect((await res.json()).data.today).toBe("2026-10-01")
        const page = (await import("node:fs")).readFileSync("app/(dashboard)/dashboard/attendance/page.tsx", "utf8")
        expect(page).not.toMatch(/new Date\(\)\s*;\s*return\s*`\$\{d\.getFullYear\(\)/)
        expect(page).not.toMatch(/\.getDate\(\)/)
    })

    it("says so when the company's date can't be had, instead of waiting for it for good", () => {
        const page = readFileSync("app/(dashboard)/dashboard/attendance/page.tsx", "utf8")
        expect(page).toContain("const { data: peopleBody, error: peopleError } = useSWR(")
        expect(page).toMatch(/if \(peopleError && !today && [^\n]*\) return <p role="alert"[^\n]*t\('error_generic'\)/)
    })
})

describe("a long list (review on #12)", () => {
    it("says it stopped short rather than passing for the whole record", async () => {
        admin()
        const full = await (await list("from=2026-10-01&to=2026-10-31&userId=busy")).json()
        expect(full.data).toMatchObject({ truncated: true, limit: 2000 })
        expect(full.data.punches).toHaveLength(2000)
        const short = await (await list()).json()
        expect(short.data).toMatchObject({ truncated: false })
        expect(short.data.punches).toHaveLength(1)
    })
})

describe("the import preview (review on #12)", () => {
    const page = () => readFileSync("app/(dashboard)/dashboard/attendance/page.tsx", "utf8")
    it("drops a reply to an older request instead of showing it over a newer one", () => {
        expect(page()).toContain("const mine = ++generation.current")
        expect(page()).toContain("if (mine !== generation.current) return")
    })
    it("imports the file and settings the report on screen was made from", () => {
        expect(page()).toMatch(/const made = commit && report \? report\.made/)
        expect(page()).toContain("form.append('file', made.file)")
    })
})
