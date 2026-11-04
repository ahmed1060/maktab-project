import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import ts from "typescript"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The last confirmations onto the building blocks (UI_PLAN.md §5 step 5, the
 * pages left). Eleven still asked in the old confirmation window, a box of its
 * own making with an amber or red button and a warning sign; each is now the
 * building blocks' dialog, through one confirmation of their own.
 */

const DIALOG = "components/ui/Dialog.tsx"

/** Where each confirmation is, and how many of them want the danger button. */
const ASKED: { file: string; count: number; danger: number }[] = [
    // Resetting points can't be undone; deleting someone can't either.
    { file: "app/(dashboard)/dashboard/employees/page.tsx", count: 2, danger: 2 },
    { file: "app/(dashboard)/dashboard/costs/CostsClient.tsx", count: 1, danger: 0 },
    // Deleting a client, never archiving one.
    { file: "app/(dashboard)/dashboard/clients/page.tsx", count: 1, danger: 1 },
    { file: "components/records/SectionsCard.tsx", count: 1, danger: 1 },
    { file: "components/records/RecordsList.tsx", count: 1, danger: 1 },
    { file: "components/locations/LocationsList.tsx", count: 1, danger: 0 },
    { file: "components/charges/ChargesList.tsx", count: 2, danger: 0 },
    // Saying a cash advance arrived: it was red, the old window's default.
    { file: "components/cash-advances/CashAdvanceHistory.tsx", count: 1, danger: 0 },
    { file: "components/lists/SavedLists.tsx", count: 1, danger: 0 },
    // A person's photo, on their profile (PR 191).
    { file: "components/profile/ProfilePhoto.tsx", count: 1, danger: 1 },
]

/** Each <ConfirmDialog> in a file, with its attributes' text by name. */
function confirmations(file: string) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const found: Map<string, string>[] = []
    const visit = (n: ts.Node) => {
        if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === "ConfirmDialog") {
            const attrs = new Map<string, string>()
            for (const p of n.attributes.properties) {
                if (ts.isJsxAttribute(p)) attrs.set(p.name.getText(sf), p.initializer ? p.initializer.getText(sf) : "true")
            }
            found.push(attrs)
        }
        ts.forEachChild(n, visit)
    }
    visit(sf)
    return found
}

describe("the old confirmation window", () => {
    it("is gone, and nothing asks through it", () => {
        expect(existsSync("components/ConfirmModal.tsx")).toBe(false)
        const users = execSync(`grep -rlE "from ['\\"](@/components|\\.)/ConfirmModal['\\"]" app components lib --include=*.tsx --include=*.ts || true`).toString().trim()
        expect(users).toBe("")
    })
})

/** One rule of the building blocks' stylesheet, or of its phones' part. */
const CSS = readFileSync("components/ui/ui.css", "utf8")
const PHONES = CSS.slice(CSS.indexOf("/* ── Phones ── */"))
function rule(selector: string, css = CSS) {
    const start = css.search(new RegExp(`\\n\\s*${selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&")} \\{`))
    expect(start, selector).toBeGreaterThan(-1)
    return css.slice(start, css.indexOf("}", start))
}

describe("a confirmation", () => {
    const src = readFileSync(DIALOG, "utf8")

    it("is one of the building blocks: a dialog with Cancel and the button that does it, the main one last", () => {
        expect(readFileSync("components/ui/index.ts", "utf8")).toContain("export { Dialog, DialogActions, ConfirmDialog } from './Dialog'")
        expect(src).toContain("export function ConfirmDialog(")
        expect(src).toContain("<Button onClick={cancel} disabled={working}>{t('cancel')}</Button>")
        // In the danger colour only for what deletes or can't be undone (DESIGN.md §5.2).
        expect(src).toContain("<Button variant={danger ? 'danger' : 'primary'} busy={working} onClick={confirm}>{confirmLabel}</Button>")
    })

    it("stays open and busy until the work its onConfirm hands back is done", () => {
        expect(src).toContain("onConfirm: () => unknown")
        expect(src).toContain("if (!work || typeof (work as Promise<unknown>).then !== 'function') return")
        expect(src).toContain(".finally(() => setWorking(false))")
        // Escape, a click outside and Cancel do nothing meanwhile, and Confirm can't go twice.
        expect(src).toContain("const cancel = () => { if (!working) onCancel() }")
        expect(src).toMatch(/<Dialog open=\{open\} onClose=\{cancel\}/)
        expect(src).toContain("if (working) return")
    })

    // A section, a client or a record can have a name with no space in it,
    // such as a long reference; on a phone it ran past the dialog's edge,
    // and the dialog scrolled sideways (found in PR 189's audit).
    it("wraps a long name inside it, in its title and in what it asks", () => {
        expect(rule(".ui-dialog-title")).toContain("overflow-wrap: anywhere")
        expect(rule(".ui-dialog-body p")).toContain("overflow-wrap: anywhere")
    })

    // A button that says a count and an amount, such as "Collect 10 charges,
    // 4,525.50 EGP", ran past its own edges on a phone in Arabic, as a
    // button keeps to one line (found in PR 189's flows).
    it("takes two lines for a button that doesn't fit on one, and one line is as tall as ever", () => {
        const button = rule(".ui-dialog-actions > .ui-btn")
        expect(button).toContain("white-space: normal")
        expect(button).toContain("height: auto")
        expect(button).toContain("min-height: 36px")
        expect(button).toContain("text-align: center")
        // On phones, as tall as a phone's buttons.
        expect(rule(".ui-dialog-actions > .ui-btn", PHONES)).toContain("min-height: 44px")
    })
})

describe("each confirmation", () => {
    for (const { file, count, danger } of ASKED) {
        it(`${file}: asked in the building blocks' dialog, the danger button only for what deletes or can't be undone`, () => {
            const asked = confirmations(file)
            expect(asked).toHaveLength(count)
            expect(asked.filter(a => a.has("danger")).length).toBe(danger)
            for (const a of asked) {
                for (const prop of ["open", "title", "body", "confirmLabel", "onConfirm", "onCancel"]) expect(a.has(prop), prop).toBe(true)
            }
        })
    }

    it("deletes a client in red, and archives one without", () => {
        const [asked] = confirmations("app/(dashboard)/dashboard/clients/page.tsx")
        expect(asked.get("danger")).toBe("{!toDelete?.inUse}")
    })

    // The photo's window of its own making is gone (PR 191): removing it is
    // asked over the page, where it was asked above that window.
    it("asks before a photo is removed over the page, now the photo's window is gone", () => {
        const [asked] = confirmations("components/profile/ProfilePhoto.tsx")
        expect(asked.has("overModal")).toBe(false)
    })
})

describe("what they say", () => {
    it("asks for nothing in the masculine in Arabic", () => {
        const keys = ["reset_points_question", "delete_employee_question", "clients_delete_question", "clients_archive_question", "records_delete_section_question",
            "records_delete_empty_section_question", "records_delete_question", "locations_archive_question", "charges_uncollect_title", "charges_uncollect_question",
            "advances_confirm_question", "lists_archive_question", "profile_photo_remove_question", "costs_pay_question", "costs_pay_question_one", "charges_collect_question"] as const
        for (const key of keys) {
            expect(ar[key], key).toBeTruthy()
            expect(ar[key], key).not.toMatch(/هل أنت متأكد|أنك تريد|هل تريد|لا تؤكّد|لا تؤكد/)
        }
    })

    // Beside Confirm receipt, on a person's own cash advance (found in PR
    // 189's audit).
    it("asks for each cash advance to be confirmed with a verbal noun, where it said it in the masculine", () => {
        expect(ar.advances_awaiting_note).not.toMatch(/^أكّد|^أكد/)
        expect(ar.advances_awaiting_note).toContain("يُرجى تأكيد")
    })

    it("deletes a client by name in one sentence in each language, where the name was stuck on the end with a Latin question mark", () => {
        expect(en.clients_delete_question).toBe("Delete {name}? This can't be undone.")
        expect(ar.clients_delete_question).toContain("{name}؟")
        const page = readFileSync("app/(dashboard)/dashboard/clients/page.tsx", "utf8")
        expect(page).not.toContain("delete_client_warning")
        expect(en).not.toHaveProperty("delete_client_warning")
        expect(ar).not.toHaveProperty("delete_client_warning")
    })

    // "Reset photo" until PR 191, which says what it does.
    it("removes a photo with a button that says so, in sentence case", () => {
        expect(en.profile_photo_remove).toBe("Remove photo")
        // A profile an admin opens is somebody else's, so it's "this" photo, not "your".
        expect(en.profile_photo_remove_question).not.toMatch(/\byour\b/i)
        expect(en).not.toHaveProperty("yes_reset")
        expect(ar).not.toHaveProperty("yes_reset")
        const [asked] = confirmations("components/profile/ProfilePhoto.tsx")
        expect(asked.get("confirmLabel")).toBe("{t('profile_photo_remove')}")
    })
})
