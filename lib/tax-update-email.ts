import type { ClientLanguage } from "./client-accounts"
import { button, coloursOf, copyLine, escape, fill as fillIn, framed, oneLine, paragraph as p, type Kinds, type WrittenEmail } from "./office-email"

/**
 * The update email (CLIENT_PORTAL_PLAN.md §4.4, step 11b; DESIGN.md §5.5,
 * The update email; PR 351): what each of a client's people who has set a
 * password is sent when an upload of the tax portal's file is saved, where
 * the company has turned it on. In the language their account keeps alone,
 * never both in one; the words are the ones agreed with the owner on
 * 2026-11-20. No amounts: what the client owes stays behind its sign-in.
 * Drawn as the invitation's email is (lib/office-email.ts). No database and
 * no sending here: lib/services/tax-update-email.service.ts gathers the
 * facts and lib/email.ts sends it.
 */

export type TaxUpdateEmailFacts = {
    language: ClientLanguage
    person: { name: string; email: string }
    office: string
    client: string
    /** The day the figures are from, as the upload kept it (YYYY-MM-DD). */
    asOf: string
    /** Whoever in the office uploaded the file, for the reply and the line to ask them; none for a Super Admin. */
    sender: { name: string; email: string } | null
    /** Nizmo's sign-in page, on Nizmo's own address. */
    signIn: string
    /** The privacy policy, on the same address. */
    privacy: string
    /** The default brand colour the Super Admin set, or none for Nizmo's own (DESIGN.md §2.1). */
    brand: string | null
}

const WORDS: Record<ClientLanguage, Record<string, string>> = {
    en: {
        subject: "The tax position of {client} was updated",
        hello: "Hello {name},",
        updated: "{office} updated the tax position of {client} on Nizmo. The figures are as of {date}.",
        open: "To see it, sign in:",
        button: "Sign in",
        copy: "If the button doesn't open, copy this link into your browser:",
        contact: "For any questions, please contact {sender} at {office}.",
        contactOffice: "For any questions, please contact {office}.",
        sentBy: "Sent through Nizmo on behalf of {office}.",
        privacy: "Privacy policy",
    },
    ar: {
        subject: "تحديث الموقف الضريبي لـ{client}",
        hello: "مرحبًا {name}،",
        updated: "تم تحديث الموقف الضريبي لـ{client} على Nizmo من {office}، والأرقام حتى تاريخ {date}.",
        open: "للاطلاع عليه، يُرجى تسجيل الدخول:",
        button: "تسجيل الدخول",
        copy: "إذا لم يفتح الزر، يمكن نسخ هذا الرابط في المتصفح:",
        contact: "للاستفسار، يُرجى التواصل مع {sender} من {office}.",
        contactOffice: "للاستفسار، يُرجى التواصل مع {office}.",
        sentBy: "أُرسلت هذه الرسالة عبر Nizmo نيابةً عن {office}.",
        privacy: "سياسة الخصوصية",
    },
}

const NAMES: Kinds = { names: new Set(["name", "office", "client", "sender"]) }

type Fields = Partial<Record<"name" | "office" | "client" | "sender" | "date", string>>

/** A sentence with its names in: as they are, kept whole in plain text, or as text in HTML. */
const fill = (sentence: string, values: Fields, as: "header" | "text" | "html") => fillIn(sentence, values, as, NAMES)

/** The day written out in the email's language, as the day it is wherever the server is: 17 November 2026, ١٧ نوفمبر ٢٠٢٦. */
function dayIn(asOf: string, language: ClientLanguage): string {
    return new Date(`${asOf}T00:00:00Z`).toLocaleDateString(language === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
}

export function taxUpdateEmail(facts: TaxUpdateEmailFacts): WrittenEmail {
    const words = WORDS[facts.language]
    const office = oneLine(facts.office)
    const sender = facts.sender && oneLine(facts.sender.name) ? { name: oneLine(facts.sender.name), email: facts.sender.email } : null
    const values: Fields = {
        name: oneLine(facts.person.name),
        office,
        client: oneLine(facts.client),
        sender: sender?.name,
        date: dayIn(facts.asOf, facts.language),
    }
    const contact = sender ? words.contact : words.contactOffice
    const subject = fill(words.subject, values, "header")

    const text = [
        fill(words.hello, values, "text"),
        "",
        fill(words.updated, values, "text"),
        "",
        words.open,
        facts.signIn,
        "",
        fill(contact, values, "text"),
        "",
        fill(words.sentBy, values, "text"),
        `${words.privacy}: ${facts.privacy}`,
    ].join("\n")

    const colours = coloursOf(facts.brand)
    const link = escape(facts.signIn)
    const html = framed({
        language: facts.language,
        subject,
        office,
        colours,
        body: [
            p(fill(words.hello, values, "html")),
            p(fill(words.updated, values, "html")),
            p(escape(words.open)),
            button(link, words.button, colours),
            copyLine(words.copy, link, colours),
            p(fill(contact, values, "html")),
        ],
        sentBy: fill(words.sentBy, values, "html"),
        privacy: { href: facts.privacy, label: words.privacy },
    })

    return {
        subject,
        text,
        html,
        fromName: office,
        replyTo: sender ? { name: sender.name, address: sender.email } : null,
    }
}
