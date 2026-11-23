import { describe, it, expect } from "vitest"
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join, dirname, resolve, relative } from "node:path"
import { PERMISSIONS, requiresOf, type Permission } from "./permissions/catalogue"

/**
 * What each screen asks the server for, against the permission that opens it
 * (LATER_CHANGES_PLAN.md §5.1 "Kept true", §5.2 step 5; PR 376), so a screen
 * that quietly needs another permission fails here, not in front of someone
 * whose role holds only the one that opens it.
 *
 * A table, checked against the code both ways:
 * - each screen's calls, found in its page and the components it uses, are
 *   the table's, no more and no fewer: a new call fails until it's written
 *   down;
 * - each call is **needed** whenever the screen is open, its route answering
 *   any of the permissions named; asked only **when** the screen checks one
 *   first, as a button or a tab does, or as the server does, giving what the
 *   button needs only to its holders; open to **anyone** in the company; or
 *   the **Super Admin's** only, as a company picker is. The route names each
 *   permission given, or the Super Admin, and the screen names each "when".
 * - a needed call is met by each permission that opens the screen: itself,
 *   one it brings (`implies`), or one it needs first (`requires`), as rules 1
 *   and 2 keep those held with it.
 *
 * In parts: these are the screens the remaining splits change (§2), so each
 * split keeps its rows; the rest wait in LATER.
 */

/**
 * `routes` narrows a call reaching several routes, as one built from a variable
 * does; `routeChecks` is where its route checks, when a service does; and
 * `screenChecks`, where the screen's "when" is checked, when the server gives
 * a button what it needs only for its holders.
 */
type Where = { routes?: string[]; routeChecks?: string; screenChecks?: string }
type Ask =
    | ({ needs: Permission[] } & Where)
    | ({ when: Permission[] } & Where)
    | "anyone"
    | "super admin"

type Screen = { opens: Permission[]; asks: Record<string, Ask> }

const SUPER_ADMIN = "super admin" as const
const ANYONE = "anyone" as const
const needs = (...permissions: Permission[]): Ask => ({ needs: permissions })
const when = (...permissions: Permission[]): Ask => ({ when: permissions })

const SCREENS: Record<string, Screen> = {
    "locations": {
        opens: ["locations.view"],
        asks: {
            "/api/locations": needs("locations.view"),
            // The client a place is for, and the list's client filter.
            "/api/clients": when("clients.view"),
            "/api/companies": SUPER_ADMIN,
        },
    },
    "lists": {
        opens: ["lists.manage"],
        asks: {
            // Renaming, merging and archiving are this screen's whole job.
            "/api/lists": needs("lists.manage"),
        },
    },
    "costs": {
        // Its tabs: Employee costs, Charged to clients and Cash advances (lib/side-bar.ts).
        opens: ["tasks.pay", "charges.view", "cash_advances.view"],
        asks: {
            "/api/tasks/payment/bulk": when("tasks.pay"),
            "/api/charges": when("charges.view"),
            "/api/charges/[x]": when("charges.manage"),
            "/api/charges/collect": when("charges.collect"),
            "/api/charges/[x]/uncollect": when("charges.collect"),
            "/api/cash-advances": when("cash_advances.view"),
            "/api/cash-advances/[x]": when("cash_advances.give"),
            "/api/cash-advances/[x]/purposes": when("cash_advances.give"),
            // The filters: a client, a place, a person, a cost's name.
            "/api/clients": when("clients.view"),
            "/api/locations": when("locations.view"),
            "/api/users": when("employees.view"),
            "/api/lists": ANYONE,
            "/api/upload": ANYONE,
            "/api/realtime/token": ANYONE,
        },
    },
    "clients": {
        opens: ["clients.view"],
        asks: {
            "/api/clients": needs("clients.view"),
            "/api/companies": SUPER_ADMIN,
        },
    },
    "clients/[id]": {
        // Its tabs, each for whoever sees it: details, records, places, charges, tax, client portal.
        opens: ["clients.view", "records.view"],
        asks: {
            "/api/clients": when("clients.view"),
            "/api/clients/accountant": when("clients.edit"),
            "/api/records": when("records.view"),
            "/api/records/sections": when("records.view"),
            "/api/records/clients": when("records.contribute"),
            "/api/records/uploads": when("records.contribute"),
            "/api/locations": when("locations.view"),
            "/api/charges": when("charges.view"),
            "/api/charges/[x]": when("charges.manage"),
            "/api/charges/collect": when("charges.collect"),
            "/api/charges/[x]/uncollect": when("charges.collect"),
            "/api/tax-claims": when("tax.view"),
            "/api/client-accounts": when("client_accounts.manage"),
            "/api/client-accounts/[x]": when("client_accounts.manage"),
            "/api/client-accounts/[x]/invitation": when("client_accounts.manage"),
            "/api/companies": SUPER_ADMIN,
            "/api/upload": ANYONE,
            "/api/realtime/token": ANYONE,
        },
    },
    "clients/[id]/statement": {
        opens: ["charges.view"],
        asks: {
            "/api/charges/statement": needs("charges.view"),
        },
    },
    "employees": {
        opens: ["employees.view"],
        asks: {
            "/api/users": needs("employees.view"),
            "/api/users/team": when("employees.assign_team"),
            "/api/users/[x]/reset-points": { when: ["requests.reset_points"], routeChecks: "lib/services/user.service.ts" },
            // The list says who is locked out only to whoever may unlock (components/SignInLock.tsx).
            "/api/users/[x]/unlock-sign-in": { when: ["employees.reset_password"], screenChecks: "app/api/users/route.ts" },
            "/api/realtime/token": ANYONE,
        },
    },
    "employees/new": {
        opens: ["employees.create"],
        asks: {
            "/api/users": needs("employees.create"),
            "/api/roles/assignable": when("employees.assign_role", "employees.request_role"),
            "/api/companies": SUPER_ADMIN,
        },
    },
    "employees/[id]/bonus": {
        opens: ["salary_adjustments.manage"],
        asks: {
            // Whose pay it is, by name: See employees, which adding one needs first (§5.3).
            "/api/users": needs("employees.view"),
            "/api/users/[x]/[x]": { needs: ["salary_adjustments.manage"], routes: ["users/[id]/bonus", "users/[id]/deduction"] },
        },
    },
    "employees/[id]/deduction": {
        opens: ["salary_adjustments.manage"],
        asks: {
            "/api/users": needs("employees.view"),
            "/api/users/[x]/[x]": { needs: ["salary_adjustments.manage"], routes: ["users/[id]/bonus", "users/[id]/deduction"] },
        },
    },
    "payroll": {
        opens: ["payroll.view"],
        asks: {
            "/api/payroll/[x]/[x]": needs("payroll.view"),
            "/api/payroll/[x]/[x]/export": needs("payroll.view"),
            "/api/attendance/discrepancies": needs("payroll.view"),
            "/api/payroll/[x]/[x]/approve": when("payroll.approve"),
            "/api/payroll/[x]/[x]/issue": when("payroll.issue_payslips"),
            "/api/payroll/[x]/[x]/paid": when("payroll.mark_paid"),
            "/api/attendance/discrepancies/[x]/resolve": when("payroll.prepare"),
            "/api/debts/[x]/waive": when("debts.waive"),
        },
    },
}

/** Company screens for the next part (§5.2 step 5). */
const LATER = [
    // The home page.
    "",
    "attendance", "cash-advances/[userId]", "check-in", "clients/[id]/tax-statement", "day-off-requests", "documents",
    "documents/payslip/[id]", "documents/settlement/[id]", "employees/[id]", "obligations", "obligations/[id]", "obligations/new",
    "profile-requests", "records", "records/[id]", "requests", "requests/history", "role-requests", "roles-and-access",
    "settings", "settings/client-messages/[kind]", "settings/terminal-guide", "tasks", "tasks/[id]", "tasks/new", "tax-export",
    "vendors", "vendors/[id]",
]

/** Not a permission's screen: the Super Admin's own, one's own, or a notice. */
const OUTSIDE: Record<string, string> = {
    "access-reviews": "the Super Admin's", "all-users": "the Super Admin's", "audit-logs": "the Super Admin's",
    "check-ins": "the Super Admin's", "client-messages": "the Super Admin's", "companies": "the Super Admin's",
    "companies/[id]/payments": "the Super Admin's", "companies/[id]/settings": "the Super Admin's",
    "companies/[id]/settings/client-messages/[kind]": "the Super Admin's", "companies/[id]/settings/terminal-guide": "the Super Admin's",
    "health": "the Super Admin's", "packages": "the Super Admin's", "policy-templates": "the Super Admin's",
    "public-holidays": "the Super Admin's", "role-change-requests": "the Super Admin's", "role-templates": "the Super Admin's",
    "super-admins": "the Super Admin's", "system-settings": "the Super Admin's", "terminal-brands": "the Super Admin's",
    "usernames": "the Super Admin's", "who-can": "the Super Admin's", "ui-kit": "the Super Admin's",
    "cash-advances/mine": "one's own", "change-password": "one's own", "email-settings": "one's own", "mfa-settings": "one's own",
    "security-settings": "one's own",
    "maintenance": "a notice", "subscription-expired": "a notice",
    // Each part against its route, for every kind of viewer (lib/history-parts.test.ts, PR 370).
    "employees/[id]/history": "tested part by part in lib/history-parts.test.ts",
}

const ROOT = process.cwd()
const DASHBOARD = join(ROOT, "app/(dashboard)/dashboard")

function resolveImport(from: string, spec: string): string | null {
    const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null
    if (!base) return null
    for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
        if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext
    }
    return null
}

/** A screen's own files: its page, and the components and hooks it uses, not the building blocks. */
function screenFiles(file: string, seen = new Set<string>()): Set<string> {
    if (seen.has(file)) return seen
    seen.add(file)
    for (const m of readFileSync(file, "utf8").matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
        const found = resolveImport(file, m[1])
        if (!found) continue
        const r = relative(ROOT, found)
        const follows = (r.startsWith("components/") && !r.startsWith("components/ui/")) || r.startsWith("app/(dashboard)/") || /^lib\/use[A-Z]/.test(r)
        if (follows) screenFiles(found, seen)
    }
    return seen
}

/** Each /api path in a file: a ${…} right after a slash is a segment, [x]; one added to a segment, as a query is, ends it. */
function callsIn(src: string): Set<string> {
    const out = new Set<string>()
    let i = 0
    while ((i = src.indexOf("/api/", i)) !== -1) {
        const quote = src[i - 1]
        if (!["'", '"', "`"].includes(quote)) { i += 5; continue }
        let path = "", j = i
        while (j < src.length) {
            const c = src[j]
            if (c === quote || c === "?" || /\s/.test(c)) break
            if (quote === "`" && c === "$" && src[j + 1] === "{") {
                if (!path.endsWith("/")) break
                let depth = 0, k = j + 1
                for (; k < src.length; k++) { if (src[k] === "{") depth++; else if (src[k] === "}" && --depth === 0) break }
                path += "[x]"
                j = k + 1
                continue
            }
            path += c
            j++
        }
        out.add(path.replace(/\/$/, ""))
        i = j
    }
    return out
}

/** The route files a call can reach: [x] is the dynamic segment, or, with none, any folder. */
function routesFor(path: string): string[] {
    let dirs = [join(ROOT, "app/api")]
    for (const part of path.replace(/^\/api\//, "").split("/")) {
        dirs = dirs.flatMap(dir => {
            if (!existsSync(dir)) return []
            if (part !== "[x]" && existsSync(join(dir, part))) return [join(dir, part)]
            const dynamic = readdirSync(dir).find(d => d.startsWith("["))
            if (dynamic) return [join(dir, dynamic)]
            return part === "[x]" ? readdirSync(dir).map(d => join(dir, d)).filter(d => statSync(d).isDirectory()) : []
        })
    }
    return dirs.map(d => join(d, "route.ts")).filter(f => existsSync(f))
}

const pageFile = (screen: string) => join(DASHBOARD, screen, "page.tsx")
const quoted = (text: string, permission: string) => text.includes(`"${permission}"`) || text.includes(`'${permission}'`)

/** What holding `permission` keeps held with it: what it brings, all the way down, and what it needs first (rules 1 and 2). */
function heldWith(permission: Permission): Set<Permission> {
    const out = new Set<Permission>([permission])
    const add = (p: Permission) => {
        for (const implied of ((PERMISSIONS[p] as { implies?: readonly Permission[] }).implies ?? [])) {
            if (!out.has(implied)) { out.add(implied); add(implied) }
        }
    }
    add(permission)
    for (const needed of requiresOf(permission)) { out.add(needed); add(needed) }
    return out
}

describe("every dashboard page", () => {
    it("is in the table, waiting for it, or outside it, once", () => {
        const pages = (function walk(dir: string): string[] {
            return readdirSync(dir).flatMap(d => {
                const p = join(dir, d)
                return statSync(p).isDirectory() ? walk(p) : d === "page.tsx" ? [relative(DASHBOARD, dir)] : []
            })
        })(DASHBOARD).sort()
        const listed = [...Object.keys(SCREENS), ...LATER, ...Object.keys(OUTSIDE)]
        expect(listed.sort()).toEqual(pages)
    })
})

describe.each(Object.entries(SCREENS))("the %s screen", (screen, { opens, asks }) => {
    const files = [...screenFiles(pageFile(screen))]
    const text = files.map(f => readFileSync(f, "utf8")).join("\n")

    it("asks the server for what the table says, no more and no less", () => {
        const found = new Set<string>()
        for (const f of files) for (const call of callsIn(readFileSync(f, "utf8"))) found.add(call)
        expect([...found].sort()).toEqual(Object.keys(asks).sort())
    })

    it("asks routes that answer as the table says", () => {
        for (const [call, ask] of Object.entries(asks)) {
            const reached = routesFor(call)
            expect(reached.length, call).toBeGreaterThan(0)
            const routes = typeof ask === "object" && ask.routes ? ask.routes.map(r => join(ROOT, "app/api", r, "route.ts")) : reached
            for (const route of routes) expect(reached, `${call}: ${route}`).toContain(route)
            // The route itself, not what it imports, which names many permissions.
            const answers = [...routes, ...(typeof ask === "object" && ask.routeChecks ? [join(ROOT, ask.routeChecks)] : [])]
                .map(f => readFileSync(f, "utf8")).join("\n")
            if (ask === SUPER_ADMIN) expect(answers.includes("SUPER_ADMIN"), call).toBe(true)
            if (typeof ask === "object") {
                const permissions = "needs" in ask ? ask.needs : ask.when
                for (const p of permissions) expect(quoted(answers, p), `${call}: ${p}`).toBe(true)
            }
        }
    })

    it("checks each permission it asks only when held", () => {
        for (const [call, ask] of Object.entries(asks)) {
            if (typeof ask === "object" && "when" in ask) {
                const checks = text + (ask.screenChecks ? readFileSync(join(ROOT, ask.screenChecks), "utf8") : "")
                expect(ask.when.some(p => quoted(checks, p)), `${call}: ${ask.when.join(" or ")}`).toBe(true)
            }
        }
    })

    it("needs nothing the permission that opens it doesn't keep held", () => {
        const unmet: string[] = []
        for (const opener of opens) {
            const held = heldWith(opener)
            for (const [call, ask] of Object.entries(asks)) {
                if (typeof ask === "object" && "needs" in ask && !ask.needs.some(p => held.has(p))) {
                    unmet.push(`${opener} opens it, but ${call} needs ${ask.needs.join(" or ")}`)
                }
            }
        }
        expect(unmet).toEqual([])
    })
})

describe("the test itself", () => {
    it("finds a call written each way: a string, a path with segments, and one with a query", () => {
        expect([...callsIn("fetch('/api/lists')")]).toEqual(["/api/lists"])
        expect([...callsIn("fetch(`/api/users/${id}/reset-points`)")]).toEqual(["/api/users/[x]/reset-points"])
        expect([...callsIn("useSWR(`/api/clients${q ? `?${q}` : ''}`)")]).toEqual(["/api/clients"])
        expect([...callsIn("fetch(`/api/payroll/${year}/${month}${companyId ? `?c=${companyId}` : ''}`)")]).toEqual(["/api/payroll/[x]/[x]"])
        expect([...callsIn("const s = 'see /api/x in the docs'")]).toEqual([])
    })

    it("keeps held what a permission brings and needs first, and nothing else", () => {
        expect([...heldWith("payroll.prepare")].sort()).toEqual(["payroll.prepare", "payroll.view", "salary.view"])
        expect(heldWith("salary_adjustments.manage").has("employees.view")).toBe(true)
        expect(heldWith("locations.view").has("clients.view")).toBe(false)
    })
})
