import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { KNOWN_REFUSALS } from "./api-errors"
import { AUDIT_ACTIONS } from "./audit-codes"
import { REFUSAL_KEYS } from "./cash-advances"

/**
 * What's left of an advance for a task or a client, moved by hand
 * (CLIENTS_PLAN.md §7.9, step 7g): the route, its refusals and words, and
 * Move to running balance on a person's cash advance. The moves themselves
 * are in cash-advance-moving.db.test.ts.
 */

const read = (path: string) => readFileSync(path, "utf8")
const ROUTE = "app/api/cash-advances/[userId]/move/route.ts"
const HISTORY = "components/cash-advances/CashAdvanceHistory.tsx"

describe("Move to running balance", () => {
    it("is a route for whoever may give and settle advances, with two-factor sign-in", () => {
        const route = read(ROUTE)
        expect(route).toMatch(/export const POST = withStandardHandler/)
        expect(route).toContain(`assertStepUp(session, "cash_advances.give")`)
        expect(route).toContain(`{ permission: "cash_advances.give" }`)
        expect(route).toContain("CashAdvanceService.move(session, params.userId, { forTaskId: body.forTaskId, forClientId: body.forClientId })")
    })

    it("says, in the person's language, when there's nothing left to move", () => {
        expect(KNOWN_REFUSALS.CASH_ADVANCE_NOTHING_HELD).toMatchObject({ status: 409 })
        expect(REFUSAL_KEYS.CASH_ADVANCE_NOTHING_HELD).toBe("advances_nothing_held")
    })

    it("is in the audit log, with its words in both languages", () => {
        expect(AUDIT_ACTIONS).toContain("MOVE_CASH_ADVANCE")
        expect(en.audit_action_MOVE_CASH_ADVANCE).toBeTruthy()
        expect(ar.audit_action_MOVE_CASH_ADVANCE).toBeTruthy()
    })

    it("is offered on each task and client held for, only to whoever may give advances, and not on one's own", () => {
        const history = read(HISTORY)
        // Under Held for, a button on each part, where the viewer may move it.
        expect(history).toMatch(/const canMove = advance\.canGive && !mine/)
        expect(history).toMatch(/canMove && <Button size="sm" icon=\{ArrowsLeftRightIcon\} aria-label=\{moveLabel\(part\)\} onClick=\{\(\) => setMoving\(part\)\}>\{t\('advances_move'\)\}<\/Button>/)
        // Confirmed first, saying how much and what it was for; then posted.
        expect(history).toContain("title={t('advances_move_title')}")
        expect(history).toContain("`/api/cash-advances/${encodeURIComponent(userId)}/move`")
        expect(history).toContain("JSON.stringify({ forTaskId: part.forTask?.id ?? null, forClientId: part.forClient?.id ?? null })")
        expect(history).toContain("showToast(t('advances_moved_done'), 'success')")
    })

    it("says a Moved entry came from a task or client since deleted", () => {
        const history = read(HISTORY)
        expect(history).toMatch(/e\.partGone \? <span>\{t\('advances_for_gone'\)\}<\/span>/)
        expect(read("components/cash-advances/types.ts")).toMatch(/partGone: boolean/)
    })

    it("has its words in both languages, the Arabic with no command to one gender", () => {
        const keys = ["advances_move", "advances_move_label", "advances_move_title", "advances_move_body", "advances_move_button", "advances_moved_done", "advances_nothing_held", "advances_for_gone"] as const
        for (const key of keys) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
        for (const key of ["advances_move_label", "advances_move_body"] as const) {
            for (const word of ["{amount}", "{name}"]) {
                expect(en[key]).toContain(word)
                expect(ar[key]).toContain(word)
            }
        }
        expect(en.advances_move_body).toContain("{person}")
        expect(ar.advances_move_body).toContain("{person}")
        const arabic = keys.map(k => ar[k]).join(" ")
        expect(arabic).not.toMatch(/(^|\s)(أدخل|اختر|حاول|اكتب|انسخ|تحقق|انتظر|اطلب|انقل|حدّث|هل تريد|هل أنت متأكد)/)
    })
})
