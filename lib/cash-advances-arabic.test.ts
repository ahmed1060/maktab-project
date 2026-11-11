import { describe, it, expect } from "vitest"
import { ar as arabic } from "./translations/ar"
import { en as english } from "./translations/en"

/**
 * The cash advance screens' Arabic, neutral as to who reads it and who
 * holds the advance (the product owner, 2026-11-11). It said the holder in
 * the masculine (معه، رصيده، عهدته، لديه، يستطيع، يؤكّد), addressed the
 * reader in the masculine (حاول، أرفقه، اختر، ادفعه، ما تضيفه), and named
 * whoever recorded an entry with a masculine verb (سجّلها {name}), whoever
 * they are.
 *
 * As the rest of the app does, it now asks with "يُرجى" and verbal nouns,
 * says the balance rather than theirs, and uses the passive where it said
 * who does what.
 */

const ar = arabic as Record<string, string>
const en = english as Record<string, string>

/** Every string the cash advance screens, the Transfer task window's money held, and a contract's end say of an advance. */
const KEYS = Object.keys(ar).filter(key =>
    key.startsWith("advances_") || key.startsWith("transfer_held_") || key.startsWith("my_cash_advance")
    || key === "settlement_advance_to_debt" || key === "end_contract_advance_stays")

/** A word on its own: between spaces, punctuation or the string's ends. */
const word = (words: string) => new RegExp(`(^|[\\s،.:—(])(${words})([\\s،.:—)؟]|$)`)

describe("the cash advances' Arabic", () => {
    it("covers every string of theirs", () => {
        expect(KEYS.length).toBeGreaterThan(150)
        for (const key of KEYS) expect(en[key], key).toBeTruthy()
    })

    it("says nothing of the person holding the advance in the masculine", () => {
        const masculine = word("معه|لديه|عنده|إليه|رصيده|عهدته|عمله|يستطيع|يؤكّد|يؤكد|يصرفها|ردّها|المستحق له|للموظف|لصاحب|سجّلها|هو")
        for (const key of KEYS) expect([key, masculine.test(ar[key])], ar[key]).toEqual([key, false])
    })

    it("asks the reader nothing in the masculine", () => {
        const masculine = word("حاول|أرفق|أرفقه|اختر|ادفع|ادفعه|أدخل|اكتب|تابع|أكّد|انتظر|لترى|تضيفه|لتدفع")
        for (const key of KEYS) expect([key, masculine.test(ar[key])], ar[key]).toEqual([key, false])
    })

    it("says the balance, not theirs, in a return or a correction refused", () => {
        expect(ar.advances_more_than_held).toBe("هذا أكثر مما في العهدة. لا يزيد الردّ على الرصيد.")
        expect(ar.advances_below_zero).toBe("هذا ينزل بالرصيد تحت الصفر. لا يخصم التصحيح أكثر من الرصيد.")
        expect(ar.advances_return_hint).toBe("نقود رُدّت دون أن تُصرف. لا يمكن أن تزيد على ما في العهدة.")
        expect(ar.advances_give_hint).toBe("تُضاف إلى الرصيد، ويمكن الصرف منها فورًا. ويُؤكَّد استلامها من التطبيق.")
    })

    it("says who recorded an entry without a verb that has a gender", () => {
        expect(ar.advances_recorded_by).toBe("بتسجيل {name}")
        expect(ar.advances_col_by).toBe("سُجّلت بواسطة")
    })

    it("asks with يُرجى and verbal nouns", () => {
        expect(ar.advances_photo_upload_failed).toContain("يُرجى المحاولة مرة أخرى")
        expect(ar.advances_photo_invalid).toContain("يُرجى إرفاقه مرة أخرى")
        expect(ar.advances_photo_attach).toBe("إرفاق إقرار الاستلام الموقّع")
        expect(ar.advances_pick_company).toBe("يُرجى اختيار شركة لعرض عُهدها.")
        expect(ar.advances_owed_pay).toBe("دفع الـ{amount} مع هذا التسليم أيضًا")
    })

    it("changes nothing in English", () => {
        expect(en.advances_more_than_held).toBe("That's more than they hold. A return is their balance at most.")
        expect(en.advances_recorded_by).toBe("Recorded by {name}")
    })
})
