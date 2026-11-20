import { describe, it, expect } from "vitest"
import {
    MESSAGE_FIELDS, MESSAGE_KINDS, MESSAGE_LANGUAGES, MESSAGE_MAX_LENGTH, NIZMO_MESSAGES,
    fillMessage, messageLength, messageProblem, messagesFrom,
} from "./client-message-template"

/**
 * The messages' templates (CLIENT_PORTAL_PLAN.md §7.1, §12 step 10a;
 * PR 346): the two messages, each in Arabic and English, their fields, Nizmo's
 * own as §7 writes them, the checks a text passes before it's kept, filling it
 * when the dialog opens, and which text a company's people are given.
 */

const CONTACT_AR = "السلام عليكم،\nأنا {person} من {client}.\nاستفسار عن الموقف الضريبي بتاريخ {asOf}:"
const CONTACT_EN = "Hello,\nThis is {person} from {client}.\nA question about the tax position as of {asOf}:"
const CLAIM_AR = "السلام عليكم،\nأنا {person} من {client}.\nاستفسار عن المطالبة رقم {number}:\nالبند: {item}\nالمتبقي: {remaining} جنيه من {original}\nآخر موعد للسداد: {due}"
const CLAIM_EN = "Hello,\nThis is {person} from {client}.\nA question about claim {number}:\nItem: {item}\nRemaining: EGP {remaining} of {original}\nLast day to pay: {due}"

/** Made-up values, as the dialog fills them. */
const PAGE = { person: "Mona Fouad", client: "Nile Trading", asOf: "16 November 2026" }
const CLAIM = { ...PAGE, number: "000110000002", item: "Income tax return", remaining: "13,723.26", original: "21,088.26", due: "31 December 2026" }

describe("the messages", () => {
    it("two, Contact the accountant and Ask about this claim, each in Arabic and English", () => {
        expect(MESSAGE_KINDS).toEqual(["contact", "claim"])
        expect(MESSAGE_LANGUAGES).toEqual(["ar", "en"])
    })

    it("their fields: the person's name, the client's and the day the figures are from; for a claim, its number, item, what remains, its original and its last day to pay too", () => {
        expect(MESSAGE_FIELDS.contact).toEqual(["person", "client", "asOf"])
        expect(MESSAGE_FIELDS.claim).toEqual(["person", "client", "asOf", "number", "item", "remaining", "original", "due"])
    })

    it("Nizmo's own as §7 writes them, the fields where the names and figures go", () => {
        expect(NIZMO_MESSAGES).toEqual({
            contact: { ar: CONTACT_AR, en: CONTACT_EN },
            claim: { ar: CLAIM_AR, en: CLAIM_EN },
        })
    })

    it("each of Nizmo's own passes the checks", () => {
        for (const kind of MESSAGE_KINDS) for (const language of MESSAGE_LANGUAGES) {
            expect([kind, language, messageProblem(kind, NIZMO_MESSAGES[kind][language])]).toEqual([kind, language, null])
        }
    })
})

describe("the checks", () => {
    it("up to 1,000 characters", () => {
        expect(MESSAGE_MAX_LENGTH).toBe(1000)
        expect(messageProblem("contact", "a".repeat(1000))).toBeNull()
        expect(messageProblem("contact", "a".repeat(1001))).toEqual({ problem: "too_long", length: 1001 })
    })

    it("counting characters as the database does, an emoji as one", () => {
        expect(messageLength("😀")).toBe(1)
        expect(messageLength("سلام")).toBe(4)
        expect(messageProblem("contact", "😀".repeat(1000))).toBeNull()
        expect(messageProblem("contact", "😀".repeat(1001))).toEqual({ problem: "too_long", length: 1001 })
    })

    it("a field counts as it's kept", () => {
        expect(messageLength("{person}")).toBe(8)
    })

    it("not empty, nor only spaces and new lines", () => {
        expect(messageProblem("contact", "")).toEqual({ problem: "empty" })
        expect(messageProblem("contact", "  \n\t \u00a0")).toEqual({ problem: "empty" })
    })

    it("only the message's own fields: a claim's number can't be filled in Contact the accountant", () => {
        expect(messageProblem("contact", "Hello {person}, about {number}")).toEqual({ problem: "field", field: "number" })
        expect(messageProblem("claim", "Hello {person}, about {number}")).toBeNull()
    })

    it("nor a field no message has", () => {
        expect(messageProblem("claim", "Hello {nickname}")).toEqual({ problem: "field", field: "nickname" })
    })

    it("braces with no field's name in them are only text", () => {
        expect(messageProblem("contact", "Hello { }, {} and {1}")).toBeNull()
    })
})

describe("filling a message", () => {
    it("Nizmo's own, unchanged, reads as it did before the templates", () => {
        expect(fillMessage("contact", "en", CONTACT_EN, PAGE)).toBe("Hello,\nThis is Mona Fouad from Nile Trading.\nA question about the tax position as of 16 November 2026:")
        expect(fillMessage("claim", "en", CLAIM_EN, CLAIM)).toBe("Hello,\nThis is Mona Fouad from Nile Trading.\nA question about claim 000110000002:\nItem: Income tax return\nRemaining: EGP 13,723.26 of 21,088.26\nLast day to pay: 31 December 2026")
    })

    it("Nizmo's own, unchanged, before the first file: the tax position with no day, as before", () => {
        expect(fillMessage("contact", "en", CONTACT_EN, { ...PAGE, asOf: null }))
            .toBe("Hello,\nThis is Mona Fouad from Nile Trading.\nA question about the tax position:")
        expect(fillMessage("contact", "ar", CONTACT_AR, { person: "منى فؤاد", client: "نايل للتجارة", asOf: null }))
            .toBe("السلام عليكم،\nأنا منى فؤاد من نايل للتجارة.\nاستفسار عن الموقف الضريبي:")
    })

    it("a changed message: each field filled where it is, as often as it's there", () => {
        expect(fillMessage("contact", "en", "Hi, {person} here ({person}).\n{client}, {asOf}", PAGE))
            .toBe("Hi, Mona Fouad here (Mona Fouad).\nNile Trading, 16 November 2026")
    })

    it("a changed message: a line whose field has nothing to fill is left out, the others kept as written", () => {
        expect(fillMessage("contact", "en", "Hello,\n\nFigures of {asOf}, please.\nThanks, {person}", { ...PAGE, asOf: null }))
            .toBe("Hello,\n\nThanks, Mona Fouad")
    })

    it("Nizmo's own with anything changed is a changed message", () => {
        expect(fillMessage("contact", "en", `${CONTACT_EN} `, { ...PAGE, asOf: null }))
            .toBe("Hello,\nThis is Mona Fouad from Nile Trading.")
    })

    it("the same in the other language: Nizmo's own Arabic isn't the English one unchanged", () => {
        expect(fillMessage("contact", "en", CONTACT_AR, { ...PAGE, asOf: null })).toBe("السلام عليكم،\nأنا Mona Fouad من Nile Trading.")
    })

    it("a field with an empty value has nothing to fill either", () => {
        expect(fillMessage("contact", "en", "Hello,\nThis is {person}.", { ...PAGE, person: "" })).toBe("Hello,")
    })

    it("braces that aren't the message's own field are left as written", () => {
        expect(fillMessage("contact", "en", "{number} and {nickname} for {person} {}", PAGE)).toBe("{number} and {nickname} for Mona Fouad {}")
        // Even where the value is there: Contact the accountant names no claim.
        expect(fillMessage("contact", "en", "{number} for {person}", { ...PAGE, number: "000110000002" })).toBe("{number} for Mona Fouad")
    })

    it("a value is put in as it is, even with a field's name in it", () => {
        expect(fillMessage("contact", "en", "{person} of {client}", { ...PAGE, person: "{client} $& $1" })).toBe("{client} $& $1 of Nile Trading")
    })

    it("lines ended by a carriage return too", () => {
        expect(fillMessage("contact", "en", "Hello,\r\nAs of {asOf}\r\nBye", { ...PAGE, asOf: null })).toBe("Hello,\nBye")
    })
})

describe("which text a company's people are given", () => {
    const row = (companyId: string | null, kind: string, language: string, text: string) => ({ companyId, kind, language, text })

    it("Nizmo's own as written, where nothing is kept", () => {
        expect(messagesFrom([])).toEqual(NIZMO_MESSAGES)
    })

    it("the Super Admin's text for Nizmo's, where it's kept", () => {
        expect(messagesFrom([row(null, "contact", "en", "Hi {person}")])).toEqual({ ...NIZMO_MESSAGES, contact: { ar: CONTACT_AR, en: "Hi {person}" } })
    })

    it("the company's own before Nizmo's, message by message and language by language", () => {
        expect(messagesFrom([
            row(null, "contact", "en", "Nizmo's {person}"),
            row("c1", "contact", "en", "Ours {person}"),
            row(null, "claim", "ar", "نيزمو {number}"),
            row("c1", "claim", "en", "Ours {number}"),
        ])).toEqual({
            contact: { ar: CONTACT_AR, en: "Ours {person}" },
            claim: { ar: "نيزمو {number}", en: "Ours {number}" },
        })
    })

    it("in whichever order they're read", () => {
        expect(messagesFrom([row("c1", "contact", "en", "Ours"), row(null, "contact", "en", "Nizmo's")]).contact.en).toBe("Ours")
    })

    it("a text that no longer passes the checks gives way to the next", () => {
        expect(messagesFrom([row("c1", "contact", "en", "About {number}"), row(null, "contact", "en", "Nizmo's {person}")]).contact.en).toBe("Nizmo's {person}")
        expect(messagesFrom([row(null, "contact", "en", " ")]).contact.en).toBe(CONTACT_EN)
    })

    it("a message or language there's no such one of is passed over", () => {
        expect(messagesFrom([row(null, "reminder", "en", "Hi"), row(null, "contact", "fr", "Salut")])).toEqual(NIZMO_MESSAGES)
    })
})
