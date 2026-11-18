import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { knownRefusal } from "./api-errors"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * A client with a tax position, deleted (CLIENT_PORTAL_PLAN.md §3.6; PR 313):
 * what the route passes on and answers, what the list says of each client,
 * and the words, in both languages. What the service does is in
 * lib/client-delete-for-good.db.test.ts, and the menus in
 * lib/clients-page.test.ts.
 */

const route = readFileSync("app/api/clients/route.ts", "utf8")
const service = readFileSync("lib/services/client.service.ts", "utf8")
const page = readFileSync("app/(dashboard)/dashboard/clients/page.tsx", "utf8")

describe("the clients route", () => {
    it("deletes for good only when asked to, by ?force=1", () => {
        expect(route).toContain("forGood: searchParams.get('force') === '1'")
    })

    it("says of each client whether it has a tax position, apart from its tasks and records, to whoever may delete it", () => {
        expect(route).toContain("inUse: _count.tasks > 0 || recordSections.length > 0")
        expect(route).toContain(`const manages = can(session.user, "clients.manage")`)
        expect(route).toContain("...(manages ? { hasTax: _count.taxClaims > 0 || !!taxPosition } : {})")
    })

    it("gives how many claims are open only to those of them who may see tax positions", () => {
        expect(route).toContain(`const seesTax = manages && can(session.user, "tax.view") && sessionHasModule(session, "TAX_POSITION")`)
        expect(route).toContain("...(seesTax ? { taxClaims: _count.taxClaims } : {})")
    })

    it("answers its two refusals as ones the person can act on, not as a fault", () => {
        expect(knownRefusal(new Error("CLIENT_NOT_ARCHIVED"))).toMatchObject({ status: 409 })
        expect(knownRefusal(new Error("CLIENT_IN_USE"))).toMatchObject({ status: 409 })
        expect(knownRefusal(new Error("CLIENT_IN_USE"))?.message).toMatch(/tasks or records/)
    })
})

describe("the service", () => {
    it("reads what holds the client one query after another, inside the transaction", () => {
        // Two at once on one transaction's connection was PR 268's fault.
        const body = service.slice(service.indexOf("static async delete"), service.indexOf("static async restore"))
        expect(body).not.toContain("Promise.all")
        expect(body).toContain(`SELECT id, "archivedAt" FROM "Client" WHERE id = \${id} FOR UPDATE`)
    })
})

describe("the Clients list", () => {
    it("archives what was confirmed for archiving: a client with a tax position too", () => {
        expect(page).toContain("const archives = (c: Client) => !!(c.inUse || c.hasTax)")
        expect(page).toContain("${archives(toDelete) ? '&archive=1' : ''}")
    })

    it("asks before deleting for good, in the danger colour, with its own question", () => {
        expect(page).toContain("`/api/clients?id=${encodeURIComponent(forGood.id)}&force=1`")
        expect(page).toMatch(/<ConfirmDialog\s+open=\{!!forGood\}[\s\S]*?danger\s/)
    })

    it("says why deleting for good was refused in the reader's language, by the refusal's code", () => {
        expect(page).toContain("CLIENT_IN_USE: 'clients_delete_for_good_in_use'")
        expect(page).toContain("CLIENT_NOT_ARCHIVED: 'clients_delete_for_good_restored'")
        expect(page).toContain("const refused = typeof body.code === 'string' ? FOR_GOOD_REFUSALS[body.code] : undefined")
        expect(page).toContain("showToast(refused ? t(refused) : body.error || t('error_generic'), 'error')")
    })
})

describe("the words, in both languages", () => {
    const KEYS = [
        "clients_archive_question_tax", "clients_archived_done_tax", "clients_delete_for_good", "clients_delete_for_good_question",
        "clients_delete_for_good_question_tax", "clients_delete_for_good_question_claims", "clients_deleted_for_good_done", "audit_field_claims",
        "clients_delete_for_good_in_use", "clients_delete_for_good_restored",
    ]

    it("has each of them, with what it fills in", () => {
        for (const words of [en, ar] as Record<string, string>[]) {
            for (const key of KEYS) expect(words[key], key).toBeTruthy()
            for (const key of ["clients_archive_question_tax", "clients_delete_for_good_question", "clients_delete_for_good_question_tax", "clients_delete_for_good_question_claims"]) expect(words[key], key).toContain("{name}")
            expect(words.clients_delete_for_good_question_claims).toContain("{count}")
            expect(words.clients_delete_for_good_question_tax).not.toContain("{count}")
        }
    })

    it("says deleting for good can't be undone, and that archiving for a tax position can", () => {
        expect(en.clients_delete_for_good).toBe("Delete permanently")
        for (const key of ["clients_delete_for_good_question", "clients_delete_for_good_question_tax", "clients_delete_for_good_question_claims"] as const) {
            expect((en as Record<string, string>)[key]).toContain("This can't be undone.")
            expect((ar as Record<string, string>)[key]).toContain("لا يمكن التراجع عن ذلك.")
        }
        expect((en as Record<string, string>).clients_archive_question_tax).toContain("It can be restored, or deleted permanently from the archive.")
    })

    it("uses each of them on the Clients list", () => {
        for (const key of KEYS.filter(k => k !== "audit_field_claims")) expect(page, key).toContain(`'${key}'`)
    })
})
