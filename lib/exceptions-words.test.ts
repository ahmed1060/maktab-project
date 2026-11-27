import { describe, it, expect } from "vitest"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * Clearer words on Exceptions (LATER_CHANGES_PLAN.md §7.11, PR 430): each
 * decision says what it does to the deduction. "Excuse" and "Accept" didn't,
 * and in Arabic both began with قبول. What each does stays as it was.
 */

describe("the two decisions on a late arrival, an early leave or an absence", () => {
    it("say what happens to the deduction", () => {
        expect(en.exc_excuse).toBe("Don't deduct")
        expect(en.exc_accept).toBe("Deduct per policy")
        expect(ar.exc_excuse).toBe("إعفاء من الخصم")
        expect(ar.exc_accept).toBe("خصم حسب السياسة")
    })

    it("no longer both start with the same word in Arabic", () => {
        expect(ar.exc_excuse.split(" ")[0]).not.toBe(ar.exc_accept.split(" ")[0])
    })

    it("say the same once done, on Decided and in the audit log", () => {
        expect([en.exc_excused, en.exc_outcome_excused, en.audit_value_EXCUSED]).toEqual(["Not deducted", "Not deducted", "Not deducted"])
        expect([en.exc_accepted, en.exc_outcome_accepted]).toEqual(["Deducted per policy", "Deducted per policy"])
        expect([ar.exc_outcome_excused, ar.audit_value_EXCUSED]).toEqual(["بدون خصم", "بدون خصم"])
        expect(ar.exc_outcome_accepted).toBe("خُصم حسب السياسة")
        expect(ar.exc_excused).toBe("تم الإعفاء من الخصم")
        expect(ar.exc_accepted).toBe("تم الخصم حسب السياسة")
    })

    it("explain, in the dialog, that it isn't counted as one of the policy's times either", () => {
        expect(en.exc_excuse_hint).toBe("Not deducted, and not counted as one of the policy's times. Say why; it's kept with the day and in the audit log.")
        expect(ar.exc_excuse_hint).toBe("عند الإعفاء لا يُخصم هذا، ولا يُحتسب ضمن مرات السياسة. يُرجى ذكر السبب؛ يُحفظ مع اليوم وفي سجل التدقيق.")
    })

    it("are named in the tab's line as they are on the buttons", () => {
        expect(en.exc_hint).toBe("Only what needs a decision: don't deduct it, saying why, or deduct it per policy. Either way it leaves the list, and every decision can be undone while the month's payroll is open.")
        expect(ar.exc_hint).toBe("ما يحتاج إلى قرار فقط: الإعفاء من الخصم مع ذكر السبب، أو الخصم حسب السياسة. وفي الحالتين يخرج من القائمة، ويمكن التراجع عن أي قرار ما دام راتب الشهر لم يُعتمد.")
    })
})

describe("a day with a punch missing, counted as it is", () => {
    it("says it's counted as present, with nothing deducted", () => {
        expect(en.exc_accept_as_is).toBe("Present, no deduction")
        expect(en.exc_accepted_as_is).toBe("Present, no deduction")
        expect(ar.exc_accept_as_is).toBe("حضور بدون خصم")
        expect(ar.exc_accepted_as_is).toBe("حضور بدون خصم")
        expect(en.exc_accept_as_is_hint).toBe("Counted as present: nothing of the day is deducted, its lateness included. Say why; it's kept with the day and in the audit log.")
        expect(ar.exc_accept_as_is_hint).toBe("يُحتسب اليوم حضورًا ولا يُخصم منه شيء، ولا من تأخيره. يُرجى ذكر السبب؛ يُحفظ مع اليوم وفي سجل التدقيق.")
    })
})

describe("what stays", () => {
    it("keeps a punch's status word, which ACCEPTED also names", () => {
        expect(en.audit_value_ACCEPTED).toBe("Accepted")
    })
})
