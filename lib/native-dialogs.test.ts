import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * No native browser dialogs anywhere in the app.
 *
 * confirm(), alert() and prompt() are drawn by the browser, not by us. They
 * ignore the palette entirely — on a dark page they open as a light grey box in
 * the browser's chrome font, with the origin printed above them — they cannot
 * be translated, they ignore the page's direction so Arabic renders
 * left-to-right, and they block the main thread, which is why a confirmation
 * could sit on top of a button still rendering its own busy state.
 *
 * NoticeModal replaced alert() and ConfirmModal replaced confirm() a long time
 * ago. Four calls were still written afterwards anyway, in files nobody thought
 * to check, which is the whole argument for a guard rather than a convention:
 * a rule that lives only in somebody's memory is a rule the next screen breaks.
 */

/** Every .tsx under app/ and components/, walked rather than globbed so this
 *  does not depend on a fs.globSync that is not in every Node's typings. */
function tsxFiles(dir: string = "", roots = ["app", "components"]): string[] {
    if (!dir) return roots.flatMap(r => tsxFiles(r, roots))
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...tsxFiles(path, roots))
        else if (entry.name.endsWith(".tsx")) out.push(path)
    }
    return out
}

// `window.confirm` and bare `confirm(` both count. Word-boundary anchored so
// ConfirmModal, onConfirm and confirmText are not swept up with them.
const NATIVE = /(?<![.\w])(?:window\s*\.\s*)?(confirm|alert|prompt)\s*\(/

describe("the app draws its own dialogs", () => {
    const offenders: string[] = []

    /**
     * Comments describing the old behaviour are not the old behaviour, and this
     * repository's own files are full of them — NoticeModal's header explains
     * at length what alert() used to do. Block comments are blanked rather than
     * deleted so line numbers survive to the failure message.
     */
    function stripComments(source: string): string {
        return source
            .replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, " "))
            .replace(/\/\/[^\n]*/g, "")
    }

    for (const file of tsxFiles()) {
        const source = readFileSync(file, "utf8")
        const code = stripComments(source)
        const original = source.split("\n")
        code.split("\n").forEach((line, i) => {
            if (NATIVE.test(line)) offenders.push(`${file}:${i + 1}  ${original[i].trim()}`)
        })
    }

    it("uses no confirm(), alert() or prompt()", () => {
        expect(offenders, `native browser dialogs found:\n${offenders.join("\n")}`).toEqual([])
    })

    it("and the guard can actually see one", () => {
        // Break-testing the regex rather than trusting it — a guard that cannot
        // match what it forbids has happened twice in this repository already.
        for (const bad of [
            "if (confirm('really?')) go()",
            "window.confirm('really?')",
            "alert('done')",
            "window.alert('done')",
            "const r = prompt('why?')",
        ]) {
            expect(NATIVE.test(bad), bad).toBe(true)
        }
    })

    it("without catching the things that merely share a name", () => {
        for (const fine of [
            "<ConfirmModal isOpen={x} />",
            "onConfirm={() => save()}",
            "confirmText={t('delete')}",
            "setConfirming({ kind: 'approve' })",
            "const confirmDisabled = !!requireTypedText",
            "showToast(t('alert_sent'))",
        ]) {
            expect(NATIVE.test(fine), fine).toBe(false)
        }
    })
})

describe("what replaced them says the same thing", () => {
    const PAYROLL = readFileSync("app/(dashboard)/dashboard/payroll/page.tsx", "utf8")
    const REQUEST = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
    const MODAL = readFileSync("components/ConfirmModal.tsx", "utf8")

    it("the payroll screen confirms through the themed modal", () => {
        // Anchored on the tag boundary: toContain("<ConfirmModal") is satisfied
        // by "<ConfirmModalX", so it could not fail on a renamed or unmounted
        // component. Third time this trap has appeared in this repository — the
        // first two are recorded in the plan.
        expect(PAYROLL).toMatch(/<ConfirmModal[\s/>]/)
        expect(PAYROLL).toContain("import ConfirmModal from '@/components/ConfirmModal'")
        expect(PAYROLL).toContain("payroll_approve_title")
        expect(PAYROLL).toContain("payroll_mark_paid_title")
        expect(PAYROLL).toContain("payroll_debt_waive_title")
    })

    it("one piece of state, so two confirmations cannot open at once", () => {
        expect(PAYROLL).toContain("const [confirming, setConfirming] = useState<")
    })

    it("the write-off still records a reason, now in the dialog", () => {
        // It was a window.prompt, which is the one native dialog that also
        // cannot be styled, translated or cancelled meaningfully.
        expect(MODAL).toContain("reason?: {")
        expect(MODAL).toContain("reasonValue.trim().length < (reason.minLength ?? 3)")
        expect(PAYROLL).toContain("payroll_debt_waive_reason_label")
        expect(PAYROLL).toContain("waive(pending.debt, reason ?? '')")
    })

    it("and the reason gates the confirm button rather than being optional", () => {
        expect(MODAL).toContain("|| reasonTooShort")
    })

    it("both of the modal's fields set their own ground and ink", () => {
        // An input with neither falls back to the browser's white ground and
        // black text, which is a white box inside a dark dialog. globals.css
        // records fixing exactly this for .input across 115 elements; these two
        // are styled inline and the typed-confirmation one had been missed —
        // on the dialog that guards restoring a backup over live data.
        const fields = MODAL.match(/<(input|textarea)[\s\S]*?\/>/g) ?? []
        expect(fields.length, "expected the typed-confirm input and the reason textarea").toBe(2)
        for (const field of fields) {
            expect(field, `a field with no background:\n${field}`).toMatch(/background: 'var\(--/)
            expect(field, `a field with no colour:\n${field}`).toMatch(/color: 'var\(--/)
        }
    })

    it("the request delete confirms in place, in a dialog of the building blocks (UI_PLAN.md §2.3)", () => {
        expect(REQUEST).toContain("open={!!deleting}")
        expect(REQUEST).toContain("title={t('requests_delete_title')}")
        expect(REQUEST).not.toMatch(NATIVE)
    })
})

describe("the copy exists in both languages", () => {
    it("every English key has an Arabic value", () => {
        const missing = Object.keys(en as any).filter(k => !(k in (ar as any)))
        expect(missing, `no Arabic translation:\n${missing.join("\n")}`).toEqual([])
    })
})
