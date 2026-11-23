import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { moduleForApiPath } from "./features/routes"
import { PERMISSIONS, isPermission, isReserved } from "./permissions/catalogue"
import { PERMISSION_GROUPS, permissionLabelKey, riskLabelKey } from "./permissions/matrix"
import { normalizeGrants } from "./permissions/grant-rules"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { isHighRisk } from "./step-up"
import { knownRefusal } from "./api-errors"
import { AUDIT_ACTIONS } from "./audit-codes"
import { CLIENT_PERSON_NAME_MAX, MAX_CLIENT_PEOPLE, accountEmail, sentPerson } from "./client-accounts"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * Client accounts as they're kept (CLIENT_PORTAL_PLAN.md §5.1, §5.2, §9, §12
 * step 6a; PR 322): the permission they come with, their routes, what's read
 * of a person sent to be added, what adding and removing are refused with,
 * and what the migration adds. The table itself, one email to one account,
 * and adding, listing and removing are in lib/client-accounts.db.test.ts.
 */

const PERMISSION = "client_accounts.manage"
// Split by what is done since PR 381 (LATER_CHANGES_PLAN.md §2; lib/client-accounts-split.test.ts).
const PARTS = ["client_accounts.view", "client_accounts.invite", "client_accounts.remove"] as const
const INVITE = "client_accounts.invite"

describe("client_accounts.manage (§9)", () => {
    it("was company-wide, in the tax position's module, with seeing clients, and high-risk; split into seeing, inviting and removing", () => {
        expect((PERMISSIONS as Record<string, unknown>)[PERMISSION]).toEqual({
            code: 70, module: "TAX_POSITION", scopes: ["COMPANY"], implies: ["clients.view"], highRisk: "Lets outsiders in", splitInto: PARTS,
        })
        expect(isPermission(PERMISSION)).toBe(true)
        expect(isReserved(PERMISSION as never)).toBe(false)
        expect(Object.values(PERMISSIONS).filter(p => p.code === 70)).toHaveLength(1)
    })

    it("asks for the step-up confirmation to invite, and says why on the role editor, in both languages", () => {
        expect(isHighRisk(INVITE)).toBe(true)
        const key = riskLabelKey(INVITE)
        expect(key).toBe("risk_lets_outsiders_in")
        expect((en as Record<string, string>)[key!]).toBe("Lets outsiders in")
        expect((ar as Record<string, string>)[key!]).toBeTruthy()
    })

    it("is asked for in words that fit it: the prompt says high-risk, not that money moves or that it can't be undone", () => {
        // Adding a client's person does neither, and the prompt is one for every high-risk action.
        for (const words of [en, ar] as Record<string, string>[]) {
            for (const key of ["step_up_hint", "step_up_enrol_hint"]) expect(words[key], key).toBeTruthy()
        }
        for (const key of ["step_up_hint", "step_up_enrol_hint"] as const) {
            expect(en[key]).toContain("high-risk action")
            expect(en[key]).not.toMatch(/moves money|cannot be undone/)
            expect(ar[key]).toContain("إجراء عالي المخاطر")
            expect(ar[key]).not.toMatch(/ينقل أموالاً|لا يمكن التراجع/)
        }
    })

    it("brings seeing clients with its parts, and nothing of the tax position", () => {
        const verdict = normalizeGrants([{ permission: PERMISSION, scope: "COMPANY" }])
        expect(verdict.ok).toBe(true)
        if (!verdict.ok) return
        expect(verdict.grants).toEqual({ ...Object.fromEntries(PARTS.map(p => [p, "COMPANY"])), "clients.view": "COMPANY" })
    })

    it("is under Client portal in the permission matrix as its parts, after the tax position's, each named in both languages", () => {
        expect(PERMISSION_GROUPS.find(g => g.key === "client_portal")?.permissions).toEqual(["tax.view", "tax.manage", ...PARTS, "client_messages.manage"])
        for (const p of [PERMISSION, ...PARTS]) for (const words of [en, ar] as Record<string, string>[]) expect(words[permissionLabelKey(p as never)], p).toBeTruthy()
        // Kept for what the audit log says of roles saved before the split.
        expect((en as Record<string, string>)[permissionLabelKey(PERMISSION as never)]).toBe("Manage who signs in for a client")
    })

    it("is the built-in Admin's, as its parts, and nobody else's until the Super Admin gives it", () => {
        for (const p of PARTS) {
            expect((BUILT_IN_GRANTS.ADMIN as Record<string, string>)[p], p).toBe("COMPANY")
            expect((BUILT_IN_GRANTS.TEAM_LEADER as Record<string, string>)[p], p).toBeUndefined()
            expect((BUILT_IN_GRANTS.EMPLOYEE as Record<string, string>)[p], p).toBeUndefined()
        }
        for (const role of Object.values(BUILT_IN_GRANTS)) expect((role as Record<string, string>)[PERMISSION]).toBeUndefined()
    })

    it("is in the roles plan: each part in its table with its routes, and inviting among the high-risk ones", () => {
        const plan = readFileSync("ROLES_PLAN.md", "utf8")
        const row = (p: string) => plan.split("\n").find(line => line.startsWith("|") && line.includes(`| \`${p}\` |`))
        expect(row("client_accounts.view")).toContain("`clients.view`")
        expect(row(INVITE)).toContain("/client-accounts")
        expect(row(INVITE)).toContain("high-risk")
        expect(row("client_accounts.remove")).toContain("DELETE /client-accounts/[id]")
        expect(plan.slice(plan.indexOf("### 6.15"), plan.indexOf("- **Marked in the catalogue"))).toContain(`\`${INVITE}\``)
    })
})

describe("the routes (§5.2)", () => {
    const list = () => readFileSync("app/api/client-accounts/route.ts", "utf8")
    const one = () => readFileSync("app/api/client-accounts/[id]/route.ts", "utf8")

    it("are under an address of their own that the client portal's gate holds", () => {
        expect(moduleForApiPath("/api/client-accounts")).toBe("TAX_POSITION")
        expect(moduleForApiPath("/api/client-accounts/abc")).toBe("TAX_POSITION")
    })

    it("list, add and remove, each for whoever holds its part (PR 381)", () => {
        expect(list()).toMatch(/export const GET = withStandardHandler\([\s\S]*?\{ permission: "client_accounts\.view" \}\)/)
        expect(list()).toMatch(/export const POST = withStandardHandler\([\s\S]*?\{ permission: "client_accounts\.invite" \}\)/)
        expect(one()).toMatch(/export const DELETE = withStandardHandler\([\s\S]*?\{ permission: "client_accounts\.remove" \}\)/)
        for (const source of [list(), one()]) expect(source.match(/withStandardHandler\(/g)!.length).toBe(source.match(/\{ permission: "client_accounts\.(view|invite|remove)" \}\)/g)!.length)
    })

    it("ask for the step-up confirmation on adding, before anything is done, and not on listing or removing", () => {
        const post = list().slice(list().indexOf("export const POST"))
        expect(post).toContain('await assertStepUp(session, "client_accounts.invite")')
        expect(post.indexOf("await assertStepUp")).toBeLessThan(post.indexOf("await addClientPerson"))
        // Removing takes access away: not high-risk since PR 381.
        expect(one()).not.toMatch(/await assertStepUp/)
        // Listing changes nothing.
        expect(list().slice(list().indexOf("export const GET"), list().indexOf("export const POST"))).not.toMatch(/await assertStepUp/)
    })
})

describe("a person sent to be added", () => {
    it("is read as the client, a name and an email", () => {
        expect(sentPerson({ clientId: "c-1", name: "Mona Fouad", email: "mona@example.com" })).toEqual({ person: { clientId: "c-1", name: "Mona Fouad", email: "mona@example.com", language: "ar" } })
    })

    it("has its name tidied: spaces at its ends and runs of them, and characters that can't be seen", () => {
        expect(sentPerson({ clientId: "c-1", name: "  Mona \t  Fouad\u0000 ", email: "mona@example.com" })).toEqual({ person: { clientId: "c-1", name: "Mona Fouad", email: "mona@example.com", language: "ar" } })
        expect(sentPerson({ clientId: "c-1", name: "منى\u200F فؤاد\u202E", email: "mona@example.com" })).toEqual({ person: { clientId: "c-1", name: "منى فؤاد", email: "mona@example.com", language: "ar" } })
        // Half of a character's pair, which the database refuses.
        expect(sentPerson({ clientId: "c-1", name: "Mona \ud83d", email: "mona@example.com" })).toEqual({ person: { clientId: "c-1", name: "Mona", email: "mona@example.com", language: "ar" } })
    })

    it("has its email kept trimmed and in small letters, so capitals make no second account", () => {
        expect(accountEmail("  Mona.Fouad@Example.COM ")).toBe("mona.fouad@example.com")
        expect(sentPerson({ clientId: "c-1", name: "Mona", email: " Mona@Example.com " })).toEqual({ person: { clientId: "c-1", name: "Mona", email: "mona@example.com", language: "ar" } })
    })

    it("is refused without a client, or with something that isn't one's id", () => {
        for (const clientId of [undefined, null, "", 7, "a b", "x".repeat(65), { id: "c-1" }]) {
            expect(sentPerson({ clientId, name: "Mona", email: "mona@example.com" }), String(clientId)).toEqual({ problem: "client" })
        }
    })

    it("is refused without a name, or with one too long", () => {
        for (const name of [undefined, null, "", "   ", "\u0000\u200F", 7, ["Mona"]]) expect(sentPerson({ clientId: "c-1", name, email: "mona@example.com" }), String(name)).toEqual({ problem: "name" })
        expect(CLIENT_PERSON_NAME_MAX).toBe(100)
        expect(sentPerson({ clientId: "c-1", name: "م".repeat(100), email: "mona@example.com" })).toHaveProperty("person")
        expect(sentPerson({ clientId: "c-1", name: "م".repeat(101), email: "mona@example.com" })).toEqual({ problem: "name_long" })
    })

    it("is refused with something that isn't an email, or one too long to be one", () => {
        for (const email of [undefined, null, "", "mona", "mona@", "@example.com", "mona@example", "mona fouad@example.com", "mona@exa mple.com", 7, "a@b.c\nbcc: x@y.z"]) {
            expect(sentPerson({ clientId: "c-1", name: "Mona", email }), String(email)).toEqual({ problem: "email" })
        }
        // 254 characters is the longest an address can be.
        expect(sentPerson({ clientId: "c-1", name: "Mona", email: `${"a".repeat(64)}@${"b".repeat(185)}.com` })).toHaveProperty("person")
        expect(sentPerson({ clientId: "c-1", name: "Mona", email: `${"a".repeat(64)}@${"b".repeat(186)}.com` })).toEqual({ problem: "email" })
    })

    it("is invited in Arabic where no language is sent, as Add person starts on it, or in English where it's asked for", () => {
        expect(sentPerson({ clientId: "c-1", name: "Mona", email: "mona@example.com" })).toHaveProperty("person.language", "ar")
        expect(sentPerson({ clientId: "c-1", name: "Mona", email: "mona@example.com", language: "ar" })).toHaveProperty("person.language", "ar")
        expect(sentPerson({ clientId: "c-1", name: "Mona", email: "mona@example.com", language: "en" })).toHaveProperty("person.language", "en")
    })

    it("is refused a language Nizmo doesn't speak", () => {
        for (const language of ["fr", "AR", "En", "", null, 1, ["en"]]) {
            expect(sentPerson({ clientId: "c-1", name: "Mona", email: "mona@example.com", language }), String(language)).toEqual({ problem: "language" })
        }
    })

    it("is refused where it's not a person at all", () => {
        for (const body of [undefined, null, "Mona", 7, []]) expect(sentPerson(body), String(body)).toEqual({ problem: "client" })
    })

    it("may be one of 20 for a client", () => {
        expect(MAX_CLIENT_PEOPLE).toBe(20)
    })
})

describe("what adding and removing are refused with", () => {
    it("each says what it is, in words", () => {
        const refusals: Record<string, number> = {
            CLIENT_ACCOUNTS_MANAGE_REQUIRED: 403,
            CLIENT_PERSON_CLIENT_REQUIRED: 400,
            CLIENT_PERSON_NAME_REQUIRED: 400,
            CLIENT_PERSON_NAME_TOO_LONG: 400,
            CLIENT_PERSON_EMAIL_INVALID: 400,
            CLIENT_PERSON_EMAIL_IN_USE: 409,
            CLIENT_PEOPLE_FULL: 409,
            CLIENT_PERSON_NOT_FOUND: 404,
            CLIENT_PERSON_LANGUAGE_INVALID: 400,
            // Sending an invitation again, to someone who has set their password since.
            CLIENT_PERSON_ACTIVE: 409,
            // Sending it again while the one before may still be on its way.
            CLIENT_INVITATION_JUST_SENT: 409,
        }
        for (const [code, status] of Object.entries(refusals)) {
            const refusal = knownRefusal(new Error(code))
            expect(refusal?.status, code).toBe(status)
            expect(refusal?.message, code).toMatch(/\.$/)
        }
        expect(knownRefusal(new Error("CLIENT_PERSON_EMAIL_IN_USE"))?.message).toBe("Someone already has this email.")
        expect(knownRefusal(new Error("CLIENT_PEOPLE_FULL"))?.message).toContain("20")
    })

    it("and the audit log names adding, removing and sending an invitation again, and one that couldn't be sent, in both languages", () => {
        for (const action of ["ADD_CLIENT_ACCOUNT", "REMOVE_CLIENT_ACCOUNT", "RESEND_CLIENT_INVITATION", "ADD_CLIENT_ACCOUNT_NOT_SENT", "RESEND_CLIENT_INVITATION_NOT_SENT"]) {
            expect(AUDIT_ACTIONS as readonly string[]).toContain(action)
            for (const words of [en, ar] as Record<string, string>[]) expect(words[`audit_action_${action}`], action).toBeTruthy()
        }
        for (const words of [en, ar] as Record<string, string>[]) expect(words.audit_field_person).toBeTruthy()
    })

    it("and an invitation that couldn't be sent says so, and what that left, never as an order", () => {
        expect(en.audit_action_ADD_CLIENT_ACCOUNT_NOT_SENT).toBe("Couldn't send a person's invitation, so they weren't added")
        expect(en.audit_action_RESEND_CLIENT_INVITATION_NOT_SENT).toBe("Couldn't send a person's invitation again, so the link sent before still works")
        expect(ar.audit_action_ADD_CLIENT_ACCOUNT_NOT_SENT).toBe("تعذّر إرسال دعوة شخص، فلم تتم الإضافة")
        expect(ar.audit_action_RESEND_CLIENT_INVITATION_NOT_SENT).toBe("تعذّرت إعادة إرسال دعوة شخص، ولا يزال الرابط السابق صالحًا")
    })

    it("and nothing here ever takes an entry out of the audit log, which is only added to (PR 328)", () => {
        const source = readFileSync("lib/services/client-account.service.ts", "utf8")
        expect(source).not.toMatch(/auditLog\.(delete|deleteMany|update|updateMany|upsert)\b/)
        expect(source).not.toMatch(/DELETE FROM "AuditLog"|UPDATE "AuditLog"/)
    })
})

describe("Manage who signs in for a client, for the companies already there (§12 step 6d, PR 330)", () => {
    const NAME = "20270109000000_client_accounts_granted"
    const sql = () => {
        expect(readdirSync("prisma/migrations").find(m => m.endsWith("_client_accounts_granted"))).toBe(NAME)
        return readFileSync(`prisma/migrations/${NAME}/migration.sql`, "utf8").split("\n").filter(line => !line.startsWith("--")).join("\n")
    }

    it("a migration gives it to the built-in Admin role alone, company-wide", () => {
        const rows = [...sql().matchAll(/\('(\w+)', '([\w.]+)', '(\w+)'\)/g)].map(([, role, permission, scope]) => [role, permission, scope])
        expect(rows).toEqual([["ADMIN", PERMISSION, "COMPANY"]])
        // Read as its parts since PR 381, which the built-in Admin is seeded with.
        for (const p of PARTS) expect(BUILT_IN_GRANTS.ADMIN[p], p).toBe("COMPANY")
        expect(BUILT_IN_GRANTS.TEAM_LEADER).not.toHaveProperty(PERMISSION)
        expect(BUILT_IN_GRANTS.EMPLOYEE).not.toHaveProperty(PERMISSION)
    })

    it("leaves a role holding it already as it is, and has only the holders of a role given it reload", () => {
        const text = sql().replace(/\s+/g, " ")
        expect(text).toContain(`ON CONFLICT ("roleId", "permission") DO NOTHING RETURNING "roleId"`)
        expect(text).toContain(`UPDATE "Role" SET "version" = "version" + 1, "updatedAt" = now() WHERE "id" IN (SELECT "roleId" FROM given)`)
        expect(text).not.toMatch(/DELETE|DROP|ALTER/)
    })

    it("comes after the release that knows it, and what it brings, seeing clients, every built-in Admin role holds", () => {
        const names = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort()
        expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("20270106000000_client_accounts"))
        expect(PERMISSIONS["client_accounts.manage"].implies).toEqual(["clients.view"])
        expect(BUILT_IN_GRANTS.ADMIN["clients.view"]).toBe("COMPANY")
    })

    it("opens nothing by itself: the package still has to have the client portal, and adding someone still asks for the code", () => {
        expect(sql()).not.toMatch(/"Package"|"Company"|"ClientAccount"/)
        expect(moduleForApiPath("/api/client-accounts")).toBe("TAX_POSITION")
        expect(isHighRisk(INVITE)).toBe(true)
    })
})

describe("the migration", () => {
    const sql = () => readFileSync("prisma/migrations/20270106000000_client_accounts/migration.sql", "utf8")
    const schema = () => readFileSync("prisma/schema.prisma", "utf8")

    it("only adds: the table, its indexes, checks and keys, and the rule for emails", () => {
        const statements = sql().split("\n").filter(line => /^[A-Z]/.test(line))
        for (const line of statements) expect(line, line).toMatch(/^(CREATE (TABLE|UNIQUE INDEX|INDEX|FUNCTION|TRIGGER) |ALTER TABLE "ClientAccount" (ADD CONSTRAINT|ENABLE ROW LEVEL SECURITY)|BEGIN$|END$)/)
        expect(sql()).not.toMatch(/\b(DROP|TRUNCATE)\b|DELETE FROM/)
        expect(sql()).not.toMatch(/\bUPDATE "(User|SuperAdmin|ClientAccount)"/)
    })

    it("keeps an account with its client and its company, and whoever added it by name", () => {
        expect(sql()).toContain('FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE')
        expect(sql()).toContain('FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE')
        expect(sql()).toContain('FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL')
        expect(sql()).toContain('"addedByName" TEXT')
    })

    it("holds what the schema can't say: a name, an email in small letters, and active only with a password", () => {
        expect(sql()).toContain('CHECK (length(btrim("name")) > 0)')
        expect(sql()).toContain(`CHECK ("email" = lower(btrim("email")) AND position('@' in "email") > 1)`)
        expect(sql()).toContain('CHECK (("password" IS NULL) = ("activatedAt" IS NULL))')
        expect(sql()).toContain('CREATE UNIQUE INDEX "ClientAccount_email_key" ON "ClientAccount"("email")')
    })

    it("has one email to one account across the three tables, each save holding the email", () => {
        expect(sql()).toContain(`pg_advisory_xact_lock(hashtext('email:' || lower(NEW.email)))`)
        for (const table of ["ClientAccount", "User", "SuperAdmin"]) {
            expect(sql()).toContain(`CREATE TRIGGER "${table}_email_once" BEFORE INSERT OR UPDATE OF email ON "${table}"`)
        }
        // Answered as any email in use is: a unique clash that names the email.
        expect(sql().match(/USING ERRCODE = 'unique_violation', CONSTRAINT = 'email_once_across_accounts'/g)).toHaveLength(2)
        // The email itself isn't written into the database's log.
        expect(sql()).not.toMatch(/RAISE EXCEPTION '[^']*%/)
    })

    it("turns Row Level Security on for the table", () => {
        expect(sql()).toContain('ALTER TABLE "ClientAccount" ENABLE ROW LEVEL SECURITY;')
    })

    it("is the schema's model, with nothing of a person's that a client account hasn't", () => {
        const model = schema().slice(schema().indexOf("model ClientAccount {"))
        const body = model.slice(0, model.indexOf("\n}"))
        for (const field of ["companyId", "clientId", "name", "email", "password", "invitedAt", "activatedAt", "lastSignInAt", "addedById", "addedByName", "sessionVersion"]) {
            expect(body, field).toMatch(new RegExp(`\\n  ${field}\\s`))
        }
        expect(body).toMatch(/\n  email\s+String\s+@unique/)
        expect(body).toMatch(/\n  password\s+String\?/)
        for (const never of ["role", "salary", "username", "teamLeaderId", "mfa"]) expect(body, never).not.toMatch(new RegExp(`\\n  ${never}`))
    })
})
