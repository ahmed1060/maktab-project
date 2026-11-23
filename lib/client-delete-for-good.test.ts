import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { knownRefusal } from "./api-errors"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { archivesInstead, deleteQuestionKey, deletedToastKey, deleteForGoodQuestion } from "./client-delete"

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
        expect(route).toContain(`const deletes = can(session.user, "clients.delete")`)
        expect(route).toContain("...(deletes ? { hasTax: _count.taxClaims > 0 || !!taxPosition } : {})")
    })

    it("gives how many claims are open only to those of them who may see tax positions", () => {
        expect(route).toContain(`const seesTax = deletes && can(session.user, "tax.view") && sessionHasModule(session, "TAX_POSITION")`)
        expect(route).toContain("...(seesTax ? { taxClaims: _count.taxClaims } : {})")
    })

    it("says whether it has people who can sign in to whoever may delete it, and how many to those of them who may manage who signs in (PR 329)", () => {
        expect(route).toContain("_count: { select: { tasks: true, taxClaims: true, accounts: true } }")
        expect(route).toContain("...(deletes ? { hasPeople: _count.accounts > 0 } : {})")
        expect(route).toContain(`const seesPeople = deletes && can(session.user, "client_accounts.view") && sessionHasModule(session, "TAX_POSITION")`)
        expect(route).toContain("...(seesPeople ? { people: _count.accounts } : {})")
    })

    it("says, once it's done, whether it was archived for its tax position or for its people (found in PR 329's flow)", () => {
        expect(route).toContain("archived: result.archived, forTax: result.forTax, forPeople: result.forPeople")
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
    it("archives what was confirmed for archiving: a client with a tax position, or people who can sign in, too", () => {
        expect(page).toContain("${archivesInstead(toDelete) ? '&archive=1' : ''}")
        expect(page).toContain("archivesInstead(c)")
        expect(page).toContain("t(deleteQuestionKey(toDelete))")
        expect(page).toContain("t(deletedToastKey(toDelete, body?.data))")
        expect(page).toContain("deleteForGoodQuestion(forGood, t, locale)")
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
        "clients_archive_question_tax", "clients_archived_done_tax", "clients_archive_question_people", "clients_archived_done_people",
        "clients_delete_for_good", "clients_delete_for_good_ask", "clients_delete_for_good_tax", "clients_delete_for_good_tax_claims",
        "clients_delete_for_good_people", "clients_delete_for_good_people_count", "clients_delete_for_good_end",
        "clients_deleted_for_good_done", "audit_field_claims", "audit_field_people", "clients_delete_for_good_in_use", "clients_delete_for_good_restored",
    ]

    it("has each of them, with what it fills in", () => {
        for (const words of [en, ar] as Record<string, string>[]) {
            for (const key of KEYS) expect(words[key], key).toBeTruthy()
            for (const key of ["clients_archive_question_tax", "clients_archive_question_people", "clients_delete_for_good_ask"]) expect(words[key], key).toContain("{name}")
            for (const key of ["clients_delete_for_good_tax_claims", "clients_delete_for_good_people_count"]) expect(words[key], key).toContain("{count}")
            for (const key of ["clients_delete_for_good_tax", "clients_delete_for_good_people", "clients_delete_for_good_end"]) expect(words[key], key).not.toMatch(/\{/)
        }
    })

    it("says deleting for good can't be undone, and that archiving for a tax position or people can", () => {
        expect(en.clients_delete_for_good).toBe("Delete permanently")
        expect(en.clients_delete_for_good_end).toBe("This can't be undone.")
        expect(ar.clients_delete_for_good_end).toBe("لا يمكن التراجع عن ذلك.")
        for (const key of ["clients_archive_question_tax", "clients_archive_question_people"] as const) {
            expect(en[key], key).toContain("It can be restored, or deleted permanently from the archive.")
            expect(ar[key], key).toContain("يمكن استعادته، أو حذفه نهائيًا من الأرشيف.")
        }
        // Archived, its people can't sign in (§5.3).
        expect(en.clients_archive_question_people).toContain("they can't sign in while it's archived")
    })

    it("uses each of them on the Clients list, or in what builds its questions", () => {
        const helper = readFileSync("lib/client-delete.ts", "utf8")
        for (const key of KEYS.filter(k => !k.startsWith("audit_field_"))) expect(page + helper, key).toContain(`'${key}'`)
    })
})

/** What Delete and Delete permanently say of a client (lib/client-delete.ts; PR 329). */
describe("what deleting a client says", () => {
    const t = (key: string) => (en as Record<string, string>)[key]
    const at = (key: string) => (ar as Record<string, string>)[key]
    const client = (over: Record<string, unknown> = {}) => ({ name: "Noor", ...over })

    it("archives a client with tasks or records, a tax position, or people who can sign in", () => {
        expect(archivesInstead(client())).toBe(false)
        for (const over of [{ inUse: true }, { hasTax: true }, { hasPeople: true }]) expect(archivesInstead(client(over)), JSON.stringify(over)).toBe(true)
    })

    it("asks, for each, why it's archived, tasks or records first, then a tax position, then people", () => {
        expect(deleteQuestionKey(client())).toBe("clients_delete_question")
        expect(deleteQuestionKey(client({ inUse: true, hasTax: true, hasPeople: true }))).toBe("clients_archive_question")
        expect(deleteQuestionKey(client({ hasTax: true, hasPeople: true }))).toBe("clients_archive_question_tax")
        expect(deleteQuestionKey(client({ hasPeople: true }))).toBe("clients_archive_question_people")
    })

    it("says what was done: deleted, archived as asked, or archived for what came to hold it meanwhile", () => {
        expect(deletedToastKey(client(), { archived: false })).toBe("clients_deleted_done")
        expect(deletedToastKey(client({ hasPeople: true }), { archived: true, forPeople: true })).toBe("clients_archived_asked")
        expect(deletedToastKey(client(), { archived: true, forTax: true })).toBe("clients_archived_done_tax")
        expect(deletedToastKey(client(), { archived: true, forPeople: true })).toBe("clients_archived_done_people")
        expect(deletedToastKey(client(), { archived: true })).toBe("clients_archived_done")
        expect(deletedToastKey(client(), undefined)).toBe("clients_deleted_done")
    })

    it("asks before deleting for good, saying what goes with it", () => {
        expect(deleteForGoodQuestion(client(), t, "en")).toBe("Delete Noor permanently? This can't be undone.")
        expect(deleteForGoodQuestion(client({ hasTax: true }), t, "en")).toBe("Delete Noor permanently? Its tax position goes with it. This can't be undone.")
        expect(deleteForGoodQuestion(client({ hasTax: true, taxClaims: 3 }), t, "en")).toBe("Delete Noor permanently? Its tax position goes with it (open claims: 3). This can't be undone.")
        expect(deleteForGoodQuestion(client({ hasPeople: true }), t, "en")).toBe("Delete Noor permanently? Its people who can sign in go with it. This can't be undone.")
        expect(deleteForGoodQuestion(client({ hasTax: true, taxClaims: 2, hasPeople: true, people: 1200 }), t, "en"))
            .toBe("Delete Noor permanently? Its tax position goes with it (open claims: 2). Its people who can sign in go with it (people: 1,200). This can't be undone.")
    })

    it("says it in Arabic, in Arabic digits", () => {
        expect(deleteForGoodQuestion(client({ name: "النور", hasPeople: true, people: 3 }), at, "ar"))
            .toBe("حذف النور نهائيًا؟ تُحذف معه حسابات بوابة العملاء الخاصة به (عددها: ٣). لا يمكن التراجع عن ذلك.")
    })

    it("writes a name as it's given, whatever it holds", () => {
        expect(deleteForGoodQuestion(client({ name: "A $& B" }), t, "en")).toBe("Delete A $& B permanently? This can't be undone.")
    })
})
