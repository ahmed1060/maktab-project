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
 * - each screen's calls, each a method and a path, found in its page and the
 *   components and hooks it uses, are the table's, no more and no fewer: a
 *   new call, or a new method at a path already there, fails until it's
 *   written down;
 * - each call is **needed** whenever the screen is open, its route answering
 *   any of the permissions named; asked only **when** the viewer holds one,
 *   with the code that decides it quoted (`gates`), in the screen, or in the
 *   server where it gives a button what it needs only for its holders; open
 *   to **anyone** in the company; or the **Super Admin's** only, with its
 *   gates too. That method's handler names each permission given, and each
 *   gate is in the code, as quoted, naming its permission;
 * - a needed call is met by each permission that opens the screen: itself,
 *   one it brings (`implies`), or one it needs first (`requires`), as rules 1
 *   and 2 keep those held with it.
 *
 * In parts: these are the screens the remaining splits change (§2), so each
 * split keeps its rows; the rest wait in LATER.
 */

/**
 * Where a screen decides to ask: code in one of its own files, or, where the
 * server decides by giving a button what it needs only for its holders, code
 * in that file.
 */
type Gate = string | { in: string; code: string }
/**
 * `routes` narrows a call reaching several routes, as one built from a
 * variable does; `routeChecks`, where the route checks when its handler
 * doesn't itself, as when a service does.
 */
type Where = { routes?: string[]; routeChecks?: string }
/**
 * A "when" whose route answers a permission the gate's brings, rather than
 * the gate's own, says which (`answers`): the leaders a new employee can be
 * put under, asked for whoever assigns teams, and answered for See employees,
 * which Assign teams brings.
 */
type Ask =
    | ({ needs: Permission[] } & Where)
    | ({ when: Permission[]; gates: Gate[]; answers?: Permission[] } & Where)
    | ({ superAdmin: Gate[] } & Where)
    | "anyone"

type Screen = { opens: Permission[]; asks: Record<string, Ask> }

const ANYONE = "anyone" as const
const needs = (...permissions: Permission[]): Ask => ({ needs: permissions })
const when = (permission: Permission | Permission[], ...gates: Gate[]): Ask => ({ when: [permission].flat(), gates })
const superAdmin = (...gates: Gate[]): Ask => ({ superAdmin: gates })

// Shared by several screens: the components' own checks.
const CLIENT_PICKERS = ["useClientOptions(onePage && can('clients.view'), true)", "const clients = useClientOptions(choosing && can('clients.view'))"]
const PLACE_FILTERS = ["const seesClients = can('clients.view') && !waits", "const seesLocations = can('locations.view') && !waits"]
const LOCATION_COMPANY = "const pickCompany = choosing && sharedChosen && superAdmin && !selectedCompanyId"
const CHARGE_FEE = ["const canManage = can('charges.manage')", ": !canManage ? [] : c.notCharged"]
const CHARGE_COLLECT = ["const canCollect = can('charges.collect')", "{canCollect && offer && <Button"]
const CHARGE_UNCOLLECT = ["const canCollect = can('charges.collect')", "? (canCollect ? [{ key: 'uncollect'"]
const LOCATION_CHANGE = ["const canEdit = can('locations.edit')", "const canArchive = can('locations.archive')", "locationActions(l, { edit: canEdit, archive: canArchive })"]

const SCREENS: Record<string, Screen> = {
    "locations": {
        opens: ["locations.view"],
        asks: {
            "GET /api/locations": needs("locations.view"),
            "POST /api/locations": when("locations.create", "adding={adding && can('locations.create')}"),
            "PUT /api/locations": when(["locations.edit", "locations.archive"], ...LOCATION_CHANGE),
            // The client a place is for, and the list's client filter.
            "GET /api/clients": when("clients.view", ...CLIENT_PICKERS),
            "GET /api/companies": superAdmin(LOCATION_COMPANY),
        },
    },
    "lists": {
        // Each part of what was Manage lists (PR 379).
        opens: ["lists.rename", "lists.merge", "lists.archive"],
        asks: {
            // Renaming, merging and archiving are this screen's whole job.
            "GET /api/lists": ANYONE,
            "PUT /api/lists": needs("lists.rename", "lists.merge", "lists.archive"),
            // Adding, which none of them includes.
            "POST /api/lists": when("lists.add", "<SavedLists adding={adding && can('lists.add')}", "action={can('lists.add') && <Button variant=\"primary\" icon={PlusIcon} onClick={() => setAdding(true)}>"),
        },
    },
    "costs": {
        // Its tabs: Employee costs, Charged to clients and Cash advances (lib/side-bar.ts).
        opens: ["tasks.pay", "charges.view", "cash_advances.view"],
        asks: {
            // Paying, from Employee costs, or with an advance given, where the server says what's owed only to whoever pays.
            "POST /api/tasks/payment/bulk": when("tasks.pay", "const pays = can(session.user as any, 'tasks.pay')",
                { in: "lib/services/costs-query.ts", code: 'if (!can(user, "tasks.pay")) return null' }),
            "GET /api/charges": when("charges.view", "const seesCharges = can(session.user as any, 'charges.view')"),
            "PATCH /api/charges/[x]": when("charges.manage", ...CHARGE_FEE),
            "POST /api/charges/collect": when("charges.collect", ...CHARGE_COLLECT),
            "POST /api/charges/[x]/uncollect": when("charges.collect", ...CHARGE_UNCOLLECT),
            "GET /api/cash-advances": when("cash_advances.view", "const seesAdvances = can(session.user as any, 'cash_advances.view')"),
            // A person's advance, as it is, for the one giving it: answered for whoever sees advances, which giving brings.
            "GET /api/cash-advances/[x]": { when: ["cash_advances.give"], gates: ["const mayGive = (h: AdvanceHolder) => can('cash_advances.give') && h.id !== viewer?.id"],
                answers: ["cash_advances.view"], routeChecks: "lib/services/cash-advance.service.ts" },
            "POST /api/cash-advances/[x]": when("cash_advances.give", "const mayGive = (h: AdvanceHolder) => can('cash_advances.give') && h.id !== viewer?.id"),
            "GET /api/cash-advances/[x]/purposes": when("cash_advances.give", "const mayGive = (h: AdvanceHolder) => can('cash_advances.give') && h.id !== viewer?.id"),
            // The filters: a client, a place, a person, a cost's name.
            "GET /api/clients": when("clients.view", "useClientOptions(can('clients.view') && !onPage, true)", ...PLACE_FILTERS),
            "GET /api/locations": when("locations.view", ...PLACE_FILTERS),
            "GET /api/users": when("employees.view", "const asks = on && can('employees.view')"),
            "GET /api/lists": ANYONE,
            "POST /api/upload": ANYONE,
            "GET /api/realtime/token": ANYONE,
        },
    },
    "clients": {
        opens: ["clients.view"],
        asks: {
            "GET /api/clients": needs("clients.view"),
            "POST /api/clients": when("clients.create", "const mayAdd = can('clients.create')", "action={mayAdd && <Button"),
            // Editing, and restoring from the archive.
            "PUT /api/clients": when(["clients.edit", "clients.delete"], "const mayEdit = can('clients.edit')", "...(mayEdit ? [{ key: 'edit'",
                "const mayDelete = can('clients.delete')", "...(c.archivedAt ? (!mayDelete ? [] : ["),
            "DELETE /api/clients": when("clients.delete", "const mayDelete = can('clients.delete')", "...(!mayDelete ? [] : [archivesInstead(c)"),
            "GET /api/companies": superAdmin("const everyCompany = superAdmin && !selectedCompanyId", "pickCompany={everyCompany}"),
        },
    },
    "clients/[id]": {
        // Its tabs, each for whoever sees it: details, records, places, charges, tax, client portal.
        opens: ["clients.view", "records.view", "charges.view"],
        asks: {
            "GET /api/clients": when("clients.view", "const seesClient = can('clients.view')", "(seesClient ? `/api/clients?id="),
            "PUT /api/clients": when("clients.delete", "? can('clients.delete') && <Button variant=\"primary\" icon={ArrowCounterClockwiseIcon}"),
            "GET /api/clients/accountant": when("clients.edit", "picks={can('clients.edit')}", "if (picks && !archived) return <AccountantPicker"),
            "PUT /api/clients/accountant": when("clients.edit", "picks={can('clients.edit')}", "if (picks && !archived) return <AccountantPicker"),
            "GET /api/records": when("records.view", "const seesRecords = can('records.view')", "{seesRecords && !sectionsFailed && ("),
            "POST /api/records": when("records.contribute", "adding={!archived && adding && can('records.contribute')}"),
            "PUT /api/records": when("records.contribute", "const canEdit = can('records.contribute')", "...(canEdit ? [{ key: 'edit'"),
            "DELETE /api/records": when("records.delete", "const canDelete = can('records.delete')", "...(canDelete ? [{ key: 'delete', label: t('records_delete')"),
            "GET /api/records/sections": when("records.view", "const seesRecords = can('records.view')", "seesRecords ? `/api/records/sections?clientId="),
            "POST /api/records/sections": when("records.contribute", "const canAdd = can('records.contribute') && !archived", "action={canAdd && <Button icon={FolderPlusIcon}"),
            "PUT /api/records/sections": when("records.edit", "const canRename = can('records.edit')", "...(canRename ? [{ key: 'rename'"),
            "DELETE /api/records/sections": when("records.delete", "const canDelete = can('records.delete')", "...(canDelete ? [{ key: 'delete', label: t('records_delete_section')"),
            // A record's form, open only to add or change one; its client is this one, not chosen.
            "GET /api/records/clients": when("records.contribute", "adding={!archived && adding && can('records.contribute')}", "const clients = useClients(choosing)"),
            "DELETE /api/records/uploads": when("records.contribute", "adding={!archived && adding && can('records.contribute')}"),
            "GET /api/locations": when("locations.view", "const seesLocations = can('locations.view')", "{seesLocations && ("),
            "POST /api/locations": when("locations.create", "adding={!archived && addingLocation && can('locations.create')}"),
            "PUT /api/locations": when(["locations.edit", "locations.archive"], ...LOCATION_CHANGE),
            "GET /api/charges": when("charges.view", "const seesCharges = can('charges.view')", "{seesCharges && <ChargesList client={{ id, name }} />}"),
            "PATCH /api/charges/[x]": when("charges.manage", ...CHARGE_FEE),
            "POST /api/charges/collect": when("charges.collect", ...CHARGE_COLLECT),
            "POST /api/charges/[x]/uncollect": when("charges.collect", ...CHARGE_UNCOLLECT),
            "GET /api/tax-claims": when("tax.view", "const seesTax = features.has('TAX_POSITION') && can('tax.view')", "{seesTax && <TaxPosition"),
            "POST /api/client-accounts": when("client_accounts.manage", "const seesPeople = features.has('TAX_POSITION') && can('client_accounts.manage')", "{seesPeople && <ClientPeople"),
            "DELETE /api/client-accounts/[x]": when("client_accounts.manage", "const seesPeople = features.has('TAX_POSITION') && can('client_accounts.manage')", "{seesPeople && <ClientPeople"),
            "POST /api/client-accounts/[x]/invitation": when("client_accounts.manage", "const seesPeople = features.has('TAX_POSITION') && can('client_accounts.manage')", "{seesPeople && <ClientPeople"),
            "GET /api/companies": superAdmin(LOCATION_COMPANY),
            "POST /api/upload": ANYONE,
            "GET /api/realtime/token": ANYONE,
        },
    },
    "clients/[id]/statement": {
        opens: ["charges.view"],
        asks: {
            "GET /api/charges/statement": needs("charges.view"),
        },
    },
    "employees": {
        opens: ["employees.view"],
        asks: {
            "GET /api/users": needs("employees.view"),
            "DELETE /api/users": when("employees.delete", "if (can('employees.delete') && e.role !== 'SUPER_ADMIN') {"),
            // Suspending and reactivating, from here, are the Super Admin's.
            "PUT /api/users": { superAdmin: ["if (isSuperAdmin && e.status !== 'ARCHIVED') {"], routeChecks: "lib/services/user.service.ts" },
            "PATCH /api/users/team": when("employees.assign_team", "const canAssignTeams = can('employees.assign_team')", "{canAssignTeams && picked.size > 0 && ("),
            "POST /api/users/[x]/reset-points": { when: ["requests.reset_points"], gates: ["if (can('requests.reset_points') && notAdmin) {"], routeChecks: "lib/services/user.service.ts" },
            // The list says who is locked out only to whoever may unlock (components/SignInLock.tsx).
            "POST /api/users/[x]/unlock-sign-in": when("employees.reset_password",
                { in: "app/api/users/route.ts", code: 'const locks = can(session.user, "employees.reset_password") ? await lockedUntil(' }),
            "GET /api/realtime/token": ANYONE,
        },
    },
    "employees/new": {
        opens: ["employees.create"],
        asks: {
            "POST /api/users": needs("employees.create"),
            // The team leaders to put the person under.
            "GET /api/users": { when: ["employees.assign_team"], answers: ["employees.view"],
                gates: ["const canAssignTeam = can('employees.assign_team')", "mayCreate && canAssignTeam ? '/api/users?role=TEAM_LEADER"] },
            "GET /api/roles/assignable": when(["employees.assign_role", "employees.request_role"], "const canAssignRole = can('employees.assign_role')",
                "const canRequestRole = !canAssignRole && can('employees.request_role')", "{(canAssignRole || canRequestRole) && ("),
            "GET /api/companies": superAdmin("mayCreate && isSuperAdmin ? '/api/companies"),
        },
    },
    "employees/[id]/bonus": {
        opens: ["salary_adjustments.manage"],
        asks: {
            // Whose pay it is, by name: See employees, which adding one needs first (§5.3).
            "GET /api/users": needs("employees.view"),
            "POST /api/users/[x]/[x]": { needs: ["salary_adjustments.manage"], routes: ["users/[id]/bonus", "users/[id]/deduction"] },
        },
    },
    "employees/[id]/deduction": {
        opens: ["salary_adjustments.manage"],
        asks: {
            "GET /api/users": needs("employees.view"),
            "POST /api/users/[x]/[x]": { needs: ["salary_adjustments.manage"], routes: ["users/[id]/bonus", "users/[id]/deduction"] },
        },
    },
    "payroll": {
        opens: ["payroll.view"],
        asks: {
            "GET /api/payroll/[x]/[x]": needs("payroll.view"),
            "GET /api/payroll/[x]/[x]/export": needs("payroll.view"),
            "GET /api/attendance/discrepancies": needs("payroll.view"),
            "POST /api/payroll/[x]/[x]": when("payroll.prepare", "const canPrepare = can('payroll.prepare')", "{canPrepare && (\n                            <Button onClick={() => action.run('save', save)}"),
            "POST /api/payroll/[x]/[x]/approve": when("payroll.approve", "const canApprove = can('payroll.approve')", "{canApprove && (\n                            <Button variant=\"primary\" onClick={openApprove}"),
            "POST /api/payroll/[x]/[x]/issue": when("payroll.issue_payslips", "const canIssue = can('payroll.issue_payslips')", ") : canIssue && ("),
            "POST /api/payroll/[x]/[x]/paid": when("payroll.mark_paid", "const canMarkPaid = can('payroll.mark_paid')", ") : canMarkPaid ? ("),
            "POST /api/attendance/discrepancies/[x]/resolve": when("payroll.prepare", "const canPrepare = can('payroll.prepare')", "{canPrepare && <Button size=\"sm\" aria-label={t('attpay_resolve_for')"),
            "POST /api/debts/[x]/waive": when("debts.waive", "const canWaive = can('debts.waive')", "{canWaive && ("),
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

const VERB = /['"](GET|POST|PUT|PATCH|DELETE)['"]/g

/**
 * Each call in a file, as "METHOD /api/path": a ${…} right after a slash is a
 * segment, [x]; one added to a segment, as a query is, ends it.
 */
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
        for (const method of methodsOf(src, i - 1)) out.add(`${method} ${path.replace(/\/$/, "")}`)
        i = j
    }
    return out
}

/**
 * The methods a call sends: GET, unless the path is fetch's first argument
 * and its options name others: as written, as both sides of a choice
 * (`editing ? 'PUT' : 'POST'`), or, given as `method`, as declared above it.
 */
function methodsOf(src: string, start: number): string[] {
    if (!/(?:fetch|fetchRetrying)\(\s*$/.test(src.slice(Math.max(0, start - 40), start))) return ["GET"]
    let depth = 0, k = start
    for (; k < src.length; k++) {
        const c = src[k]
        if ("([{".includes(c)) depth++
        else if (")]}".includes(c)) { if (depth === 0) break; depth-- }
    }
    const args = src.slice(start, k)
    const named = args.match(/method:\s*([^,}\n]+)/)
    const verbs = (text: string) => [...new Set([...text.matchAll(VERB)].map(m => m[1]))]
    if (named && verbs(named[1]).length) return verbs(named[1])
    if (named || /\bmethod\s*[,}]/.test(args)) {
        const declared = src.slice(0, start).split("\n").reverse().find(line => /\bmethod\b/.test(line) && verbs(line).length)
        if (declared) return verbs(declared)
    }
    return ["GET"]
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

/** A method's handler in a route file: from its export to the next one. */
function handlerOf(route: string, method: string): string | null {
    const src = readFileSync(route, "utf8")
    const parts = src.split(/^(?=export (?:const|async function|function) (?:GET|POST|PUT|PATCH|DELETE)\b)/m)
    return parts.find(part => new RegExp(`^export (?:const|async function|function) ${method}\\b`).test(part)) ?? null
}

const gateCode = (gate: Gate) => (typeof gate === "string" ? gate : gate.code)
const SUPER_ADMIN_WORD = /super_?admin/i

/**
 * What's wrong with a screen's gates: one not in the code as quoted, or a
 * call's gates not naming its permission, or the Super Admin.
 */
function gateProblems(asks: Record<string, Ask>, text: string): string[] {
    const out: string[] = []
    for (const [call, ask] of Object.entries(asks)) {
        if (typeof ask !== "object" || !("gates" in ask || "superAdmin" in ask)) continue
        const gates = "gates" in ask ? ask.gates : ask.superAdmin
        if (!gates.length) out.push(`${call}: no gate`)
        for (const gate of gates) {
            const where = typeof gate === "string" ? text : readFileSync(join(ROOT, gate.in), "utf8")
            if (!where.includes(gateCode(gate))) out.push(`${call}: not in the code: ${gateCode(gate)}`)
        }
        const codes = gates.map(gateCode).join("\n")
        if ("gates" in ask) for (const p of ask.when) { if (!quoted(codes, p)) out.push(`${call}: no gate naming ${p}`) }
        else if (!SUPER_ADMIN_WORD.test(codes)) out.push(`${call}: no gate naming the Super Admin`)
    }
    return out
}

/** A gated call whose route answers what its gate's permission doesn't keep held. */
function answerProblems(asks: Record<string, Ask>): string[] {
    const out: string[] = []
    for (const [call, ask] of Object.entries(asks)) {
        if (typeof ask !== "object" || !("when" in ask) || !ask.answers) continue
        for (const gate of ask.when) {
            if (!ask.answers.some(p => heldWith(gate).has(p))) out.push(`${gate} asks ${call}, which answers ${ask.answers.join(" or ")}`)
        }
    }
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

    it("asks the server for what the table says, each method at each path, no more and no less", () => {
        const found = new Set<string>()
        for (const f of files) for (const call of callsIn(readFileSync(f, "utf8"))) found.add(call)
        expect([...found].sort()).toEqual(Object.keys(asks).sort())
    })

    it("asks routes whose handler for that method answers as the table says", () => {
        for (const [call, ask] of Object.entries(asks)) {
            const [method, path] = call.split(" ")
            const reached = routesFor(path)
            expect(reached.length, call).toBeGreaterThan(0)
            const routes = typeof ask === "object" && "routes" in ask && ask.routes ? ask.routes.map(r => join(ROOT, "app/api", r, "route.ts")) : reached
            const handlers: string[] = []
            for (const route of routes) {
                expect(reached, `${call}: ${route}`).toContain(route)
                const handler = handlerOf(route, method)
                expect(handler, `${call}: ${relative(ROOT, route)} has no ${method}`).not.toBeNull()
                handlers.push(handler!)
            }
            const answers = [...handlers, ...(typeof ask === "object" && "routeChecks" in ask && ask.routeChecks ? [readFileSync(join(ROOT, ask.routeChecks), "utf8")] : [])].join("\n")
            if (typeof ask === "object" && "superAdmin" in ask) expect(SUPER_ADMIN_WORD.test(answers), call).toBe(true)
            if (typeof ask === "object" && ("needs" in ask || "when" in ask)) {
                for (const p of "needs" in ask ? ask.needs : ask.answers ?? ask.when) expect(quoted(answers, p), `${call}: ${p}`).toBe(true)
            }
        }
    })

    it("asks each call that's only for some only where the code quoted decides it", () => {
        expect(gateProblems(asks, text)).toEqual([])
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

    it("answers each call that's only for some for whoever its gate lets ask it", () => {
        expect(answerProblems(asks)).toEqual([])
    })
})

describe("the test itself", () => {
    it("finds a call written each way: a string, a path with segments, and one with a query", () => {
        expect([...callsIn("fetch('/api/lists')")]).toEqual(["GET /api/lists"])
        expect([...callsIn("fetch(`/api/users/${id}/reset-points`)")]).toEqual(["GET /api/users/[x]/reset-points"])
        expect([...callsIn("useSWR(`/api/clients${q ? `?${q}` : ''}`)")]).toEqual(["GET /api/clients"])
        expect([...callsIn("fetch(`/api/payroll/${year}/${month}${companyId ? `?c=${companyId}` : ''}`)")]).toEqual(["GET /api/payroll/[x]/[x]"])
        expect([...callsIn("const s = 'see /api/x in the docs'")]).toEqual([])
    })

    it("tells each call's method: as written, both sides of a choice, or as declared", () => {
        expect([...callsIn("await fetch('/api/lists', { method: 'PUT', body })")]).toEqual(["PUT /api/lists"])
        expect([...callsIn("await fetch('/api/locations', {\n method: editing ? 'PUT' : 'POST',\n })")].sort()).toEqual(["POST /api/locations", "PUT /api/locations"])
        expect([...callsIn("const go = async (method: 'POST' | 'PUT' = 'PUT') => {\n await fetch('/api/lists', { method, body })")].sort()).toEqual(["POST /api/lists", "PUT /api/lists"])
        expect([...callsIn("const url = '/api/charges'; await fetch(url, { method: 'POST' })")]).toEqual(["GET /api/charges"])
    })

    it("reads only the handler for the method", () => {
        const route = join(ROOT, "app/api/payroll/[year]/[month]/route.ts")
        expect(handlerOf(route, "GET")).toContain("export const GET")
        expect(handlerOf(route, "GET")).not.toContain("export const POST")
        expect(handlerOf(route, "DELETE")).toBeNull()
    })

    it("finds a gate that isn't there, or doesn't name its permission or the Super Admin", () => {
        const code = "const mayAdd = can('clients.create')\nconst everyCompany = superAdmin && !selectedCompanyId"
        expect(gateProblems({ "POST /api/clients": when("clients.create", "const mayAdd = can('clients.create')") }, code)).toEqual([])
        expect(gateProblems({ "POST /api/clients": when("clients.create", "const mayEdit = can('clients.edit')") }, code)).toHaveLength(2)
        expect(gateProblems({ "POST /api/clients": when("clients.delete", "const mayAdd = can('clients.create')") }, code)).toEqual(["POST /api/clients: no gate naming clients.delete"])
        expect(gateProblems({ "GET /api/companies": superAdmin("const mayAdd = can('clients.create')") }, code)).toEqual(["GET /api/companies: no gate naming the Super Admin"])
        expect(gateProblems({ "GET /api/companies": superAdmin("const everyCompany = superAdmin && !selectedCompanyId") }, code)).toEqual([])
    })

    it("finds a gated call answered for what its gate's permission doesn't keep held", () => {
        const leaders = (answers: Permission[]): Ask => ({ when: ["employees.assign_team"], gates: [], answers })
        expect(answerProblems({ "GET /api/users": leaders(["employees.view"]) })).toEqual([])
        expect(answerProblems({ "GET /api/users": leaders(["salary.view"]) })).toEqual(["employees.assign_team asks GET /api/users, which answers salary.view"])
    })

    it("keeps held what a permission brings and needs first, and nothing else", () => {
        expect([...heldWith("payroll.prepare")].sort()).toEqual(["payroll.prepare", "payroll.view", "salary.view"])
        expect(heldWith("salary_adjustments.manage").has("employees.view")).toBe(true)
        expect(heldWith("locations.view").has("clients.view")).toBe(false)
    })
})
