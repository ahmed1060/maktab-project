import { describe, it, expect } from "vitest"
import { whatsappNumber } from "@/lib/whatsapp-number"
import { updateUserSchema } from "@/lib/validations/user.schema"

/**
 * A person's WhatsApp number, as typed on their profile and as it's kept
 * (CLIENT_PORTAL_PLAN.md §7; DESIGN.md §5.5; PR 340): an Egyptian mobile
 * starting 01, or the number with its country code (+), kept with its
 * country code. Empty is no number.
 */
describe("a WhatsApp number, as it's kept", () => {
    it("keeps an Egyptian mobile typed from 01 with its country code", () => {
        expect(whatsappNumber("01001234567")).toEqual({ ok: true, number: "+201001234567" })
        for (const prefix of ["010", "011", "012", "015"]) expect(whatsappNumber(`${prefix}12345678`), prefix).toEqual({ ok: true, number: `+2${prefix}12345678` })
    })

    it("keeps a number typed with its country code as it is", () => {
        expect(whatsappNumber("+201001234567")).toEqual({ ok: true, number: "+201001234567" })
        expect(whatsappNumber("+971501234567")).toEqual({ ok: true, number: "+971501234567" })
        expect(whatsappNumber("+447911123456")).toEqual({ ok: true, number: "+447911123456" })
        // 00 is how a country code is often dialled in Egypt.
        expect(whatsappNumber("00201001234567")).toEqual({ ok: true, number: "+201001234567" })
    })

    it("takes spaces, dashes, dots and brackets out, and Arabic digits as theirs", () => {
        expect(whatsappNumber(" 010 0123 4567 ")).toEqual({ ok: true, number: "+201001234567" })
        expect(whatsappNumber("010-0123-4567")).toEqual({ ok: true, number: "+201001234567" })
        expect(whatsappNumber("(+20) 100.123.4567")).toEqual({ ok: true, number: "+201001234567" })
        expect(whatsappNumber("٠١٠٠١٢٣٤٥٦٧")).toEqual({ ok: true, number: "+201001234567" })
        expect(whatsappNumber("۰۱۰۰۱۲۳۴۵۶۷")).toEqual({ ok: true, number: "+201001234567" })
        expect(whatsappNumber("+٢٠ ١٠٠ ١٢٣ ٤٥٦٧")).toEqual({ ok: true, number: "+201001234567" })
        // A space that doesn't break, as a pasted number can have.
        expect(whatsappNumber("010\u00a00123\u00a04567")).toEqual({ ok: true, number: "+201001234567" })
    })

    it("is no number when it's left empty", () => {
        expect(whatsappNumber("")).toEqual({ ok: true, number: null })
        expect(whatsappNumber("   ")).toEqual({ ok: true, number: null })
    })

    it("refuses what isn't a mobile number", () => {
        for (const typed of [
            "0100123456",       // a digit short
            "010012345678",     // a digit over
            "01301234567",      // no Egyptian mobile starts 013
            "0221234567",       // a Cairo landline
            "1001234567",       // without its 0 or its country code
            "+20221234567",     // an Egyptian landline, with its code
            "+2010012345678",   // an Egyptian mobile a digit over
            "+0201001234567",   // no country code starts 0
            "+1234567",         // too short to be anyone's
            "+1234567890123456", // longer than a number can be
            "010 abc 4567",
            "010+0123+4567",
            "+",
        ]) expect(whatsappNumber(typed), typed).toEqual({ ok: false })
    })
})

describe("a WhatsApp number, as a profile's save sends it", () => {
    it("is kept as it was typed, for the service to read, or null to take it away", () => {
        expect(updateUserSchema.parse({ id: "u1", whatsappNumber: "010 0123 4567" }).whatsappNumber).toBe("010 0123 4567")
        expect(updateUserSchema.parse({ id: "u1", whatsappNumber: null }).whatsappNumber).toBeNull()
        // Absent is left as it is: the profile's own form doesn't send it.
        expect("whatsappNumber" in updateUserSchema.parse({ id: "u1" })).toBe(false)
    })

    it("refuses what can't be a number, before the service reads it", () => {
        expect(updateUserSchema.safeParse({ id: "u1", whatsappNumber: "0".repeat(41) }).success).toBe(false)
        expect(updateUserSchema.safeParse({ id: "u1", whatsappNumber: 1001234567 }).success).toBe(false)
    })
})
