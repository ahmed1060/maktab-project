import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { KNOWN_REFUSALS } from "./api-errors"
import { AUDIT_ACTIONS } from "./audit-codes"
import { transferPlan } from "./cash-advance-transfer"

/**
 * What's held for a task follows it when it's transferred (CLIENTS_PLAN.md
 * §7.9, step 7h): who keeps theirs, whose passes to whom, and whose joins
 * their running balance; Transfer task saying so before it's sent; and the
 * money passed on, confirmed on My cash advance. Against a real Postgres, in
 * cash-advance-transfer.db.test.ts.
 */

const read = (path: string) => readFileSync(path, "utf8")
const everyone = () => true

describe("what happens to what's held for the task", () => {
    it("moves nothing where no one's added, as no copy is made", () => {
        expect(transferPlan({ current: ["a", "b"], next: ["b"], held: [{ userId: "a", amount: 100 }], picked: null, mayPass: everyone }))
            .toEqual({ copy: false, moves: [], needsReceiver: false })
    })

    it("keeps the money of whoever's still on it, now for the copy, rights or not", () => {
        expect(transferPlan({ current: ["a"], next: ["a", "b"], held: [{ userId: "a", amount: 100 }], picked: null, mayPass: () => false }).moves)
            .toEqual([{ userId: "a", amount: 100, what: "KEPT" }])
    })

    it("passes what someone left off holds to the copy's only person", () => {
        expect(transferPlan({ current: ["a"], next: ["b"], held: [{ userId: "a", amount: 100 }], picked: null, mayPass: everyone }))
            .toEqual({ copy: true, moves: [{ userId: "a", amount: 100, what: "PASSED", to: "b" }], needsReceiver: false })
    })

    it("needs a pick where the copy has more than one, and takes the one picked", () => {
        const held = [{ userId: "a", amount: 100 }]
        expect(transferPlan({ current: ["a"], next: ["b", "c"], held, picked: null, mayPass: everyone }))
            .toEqual({ copy: true, moves: [{ userId: "a", amount: 100, what: "PASSED", to: null }], needsReceiver: true })
        expect(transferPlan({ current: ["a"], next: ["b", "c"], held, picked: "c", mayPass: everyone }).moves)
            .toEqual([{ userId: "a", amount: 100, what: "PASSED", to: "c" }])
    })

    it("moves it to their own running balance where whoever transfers it may not give either advance", () => {
        const held = [{ userId: "a", amount: 100 }]
        expect(transferPlan({ current: ["a"], next: ["b"], held, picked: null, mayPass: id => id !== "a" }).moves)
            .toEqual([{ userId: "a", amount: 100, what: "RUNNING" }])
        expect(transferPlan({ current: ["a"], next: ["b"], held, picked: null, mayPass: id => id !== "b" }).moves)
            .toEqual([{ userId: "a", amount: 100, what: "RUNNING" }])
        // Nothing to pass, so no pick needed.
        expect(transferPlan({ current: ["a"], next: ["b", "c"], held, picked: null, mayPass: () => false }).needsReceiver).toBe(false)
    })

    // Codex on PR 241: someone no longer at work, or another company's, takes none.
    it("passes nothing to a receiver who may not take it: it joins the running balance", () => {
        const held = [{ userId: "a", amount: 100 }]
        expect(transferPlan({ current: ["a"], next: ["b"], held, picked: null, mayPass: everyone, mayReceive: id => id !== "b" }).moves)
            .toEqual([{ userId: "a", amount: 100, what: "RUNNING" }])
        // Still on it, a person keeps their own, whoever they are.
        expect(transferPlan({ current: ["a"], next: ["a", "b"], held, picked: null, mayPass: everyone, mayReceive: () => false }).moves)
            .toEqual([{ userId: "a", amount: 100, what: "KEPT" }])
    })

    it("leaves out whoever holds nothing, and anyone not on the task", () => {
        expect(transferPlan({ current: ["a", "b"], next: ["a", "c"], held: [{ userId: "a", amount: 0 }, { userId: "b", amount: 50 }, { userId: "z", amount: 10 }], picked: null, mayPass: everyone }).moves)
            .toEqual([{ userId: "b", amount: 50, what: "PASSED", to: null }])
    })
})

describe("the transfer", () => {
    it("follows the plan as it makes the copy, asking for the code once and only if anything passes", () => {
        const service = read("lib/services/cash-advance.service.ts")
        expect(service).toContain("if (plan.needsReceiver) throw new Error(\"TRANSFER_HELD_RECEIVER_REQUIRED\")")
        expect(service).toContain("mayReceive: id => atWork(found.get(id)),")
        expect(service).toContain("if (plan.moves.some(m => m.what === \"PASSED\")) await move.assertCode()")
        expect(service).toContain("await movedToRunning(tx, companyId, m.userId, from, \"TAKEN_OFF\", by)")
        const tasks = read("lib/services/task.service.ts")
        expect(tasks).toContain("await CashAdvanceService.followTransfer(tx, {")
        expect(tasks).toContain("assertCode: () => assertStepUp(session, \"cash_advances.give\"),")
        expect(tasks).toContain("throw new Error(\"TRANSFER_HELD_RECEIVER_INVALID\")")
    })

    it("says, in the person's language, where who takes it is missing or not someone on the copy", () => {
        for (const code of ["TRANSFER_HELD_RECEIVER_REQUIRED", "TRANSFER_HELD_RECEIVER_INVALID"]) expect(KNOWN_REFUSALS[code]).toMatchObject({ status: 400 })
        const page = read("app/(dashboard)/dashboard/tasks/[id]/client.tsx")
        expect(page).toContain("TRANSFER_HELD_RECEIVER_REQUIRED: 'transfer_held_receiver_required',")
        expect(page).toContain("TRANSFER_HELD_RECEIVER_INVALID: 'transfer_held_receiver_invalid',")
        // The code prompt turned down: it said what it needed.
        expect(page).toContain("if (data.code === 'STEP_UP_REQUIRED' || data.code === 'MFA_ENROL_REQUIRED') return")
        expect(page).toContain("body: JSON.stringify({ newAssigneeIds: transferAssigneeIds, ...(heldGoesTo ? { heldGoesTo } : {}) }),")
    })

    it("is in the audit log, with its words in both languages", () => {
        expect(AUDIT_ACTIONS).toContain("TRANSFER_CASH_ADVANCE")
        for (const key of ["audit_action_TRANSFER_CASH_ADVANCE", "audit_value_TAKEN_OFF", "audit_field_fromTaskId", "audit_field_toTaskId", "audit_field_fromUserId", "audit_field_toUserId"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
    })
})

describe("Transfer task's dialog", () => {
    const dialog = read("components/TaskTransferModal.tsx")

    it("asks the server what would happen for the people picked, and who'd take it", () => {
        expect(dialog).toContain("`/api/tasks/${encodeURIComponent(taskId)}/transfer?to=${transferAssigneeIds.map(encodeURIComponent).join(',')}&goesTo=${encodeURIComponent(picked)}`")
        expect(read("app/api/tasks/[id]/transfer/route.ts")).toContain("TaskService.transferPreview(params.id, session, to, searchParams.get('goesTo') || null)")
    })

    it("says it under a heading of its own, a line for each person, the amount only where it's theirs to see", () => {
        expect(dialog).toContain("<h3 id={`${id}-held`} className=\"ui-settlement-title\">{t('transfer_held_title')}</h3>")
        expect(dialog).toContain("fill(t(m.amount === null ? without : withAmount), {")
        expect(dialog).toContain(": <p>{t('transfer_held_stays')}</p>}")
    })

    it("keeps the last lines while the next are worked out, and waits for them, and for a pick where one's needed", () => {
        expect(dialog).toContain("const preview = current ?? shown")
        expect(dialog).toContain("const ready = !!current && !(current.pickReceiver && !picked)")
        expect(dialog).toMatch(/disabled=\{transferAssigneeIds\.length === 0 \|\| !ready\}/)
        expect(dialog).toContain("aria-live=\"polite\" aria-busy={!current || undefined}")
    })

    it("picks who takes it from the people it goes to, and only them", () => {
        expect(dialog).toContain("const picked = transferAssigneeIds.includes(goesTo) ? goesTo : ''")
        expect(dialog).toContain("...transferAssigneeIds.map(person => ({ value: person, label: nameOf(person) })),")
        expect(dialog).toContain("onClick={() => onTransfer(picked || null)}")
    })

    it("says so where it couldn't be worked out, with Try again", () => {
        expect(dialog).toContain("<p className=\"ui-error\">{t('transfer_held_failed')}</p>")
        expect(dialog).toContain("onClick={() => { void mutate() }}")
    })
})

describe("the money passed on, on My cash advance", () => {
    const history = read("components/cash-advances/CashAdvanceHistory.tsx")

    it("is confirmed as an advance given, saying from whom", () => {
        expect(history).toContain("const passedHere = (e: AdvanceEntry) => e.kind === 'TRANSFERRED' && e.amount > 0 && !!e.counterpartName")
        expect(history).toContain("const awaitingOf = (e: AdvanceEntry) => (e.kind === 'GIVEN' || passedHere(e)) && !e.confirmedAt")
        expect(history).toContain("fill(t('advances_confirm_passed_question'), { amount: money(confirming.amount), name: <bdi>{confirming.counterpartName}</bdi> })")
    })

    it("says, on each line passed on, to whom or from whom", () => {
        expect(history).toContain("fill(t(e.amount < 0 ? 'advances_to_name' : 'advances_from_name'), { name: <bdi>{e.counterpartName}</bdi> })")
        expect(history).toContain("TRANSFERRED: 'advances_kind_transferred'")
    })
})

describe("its words", () => {
    const keys = ["transfer_held_title", "transfer_held_kept", "transfer_held_kept_hidden", "transfer_held_passed", "transfer_held_passed_hidden",
        "transfer_held_passed_pick", "transfer_held_passed_pick_hidden", "transfer_held_running", "transfer_held_running_hidden", "transfer_held_stays",
        "transfer_held_to_label", "transfer_held_to_hint", "transfer_held_to_none", "transfer_held_failed", "transfer_held_receiver_required",
        "transfer_held_receiver_invalid", "advances_kind_transferred", "advances_from_name", "advances_to_name", "advances_confirm_passed_question"] as const

    it("are in both languages, each with what it's filled with", () => {
        for (const key of keys) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
            for (const blank of en[key].match(/\{\w+\}/g) ?? []) expect(ar[key], `${key} ${blank}`).toContain(blank)
        }
        for (const key of ["transfer_held_kept", "transfer_held_passed", "transfer_held_passed_pick", "transfer_held_running"] as const) {
            expect(en[key]).toContain("{amount}")
            expect(en[`${key}_hidden`]).not.toContain("{amount}")
        }
    })

    it("in Arabic, command no one gender and ask no question that does", () => {
        const arabic = keys.map(k => ar[k]).join(" ")
        expect(arabic).not.toMatch(/(^|\s)(أدخل|اختر|حاول|اكتب|انسخ|تحقق|انتظر|اطلب|انقل|حدّد|هل تريد|هل أنت متأكد|أنك تريد)/)
    })
})
